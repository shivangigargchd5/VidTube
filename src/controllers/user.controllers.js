import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { User } from "../models/user.models.js";
import { Subscription } from "../models/subscription.model.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const options = { httpOnly: true, secure: true }

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        return { accessToken, refreshToken };
    }
    catch (error) {
        throw new ApiError(500, `Could not get Access and Refresh token: ${error}`)
    }
}

const registerUser = asyncHandler(async (req, res) => {
    const { fullname, email, username, password } = req.body;
    if ([fullname, email, username, password].some((item) => item?.trim() === "")) {
        throw new ApiError(400, "All fields are compulsory");
    }
    const userExists = await User.findOne({
        $or: [{ username }, { email }]
    })

    if (userExists) {
        throw new ApiError(400, "Username or email already exist");
    }


    const avatarLocalPath = req.files?.avatar[0]?.path;
    const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar is required");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);
    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!avatar) {
        throw new ApiError(500, "Issue uploading avatar on cloudinary");
    }

    const user = await User.create({
        username: username.toLowerCase(),
        fullname,
        email,
        password,
        avatar: avatar.url,
        coverImage: coverImage?.url || ""
    });

    const userCreated = await User.findById(user._id).select("-password -refreshToken");

    if (!userCreated) {
        throw new ApiError(500, "Couldn't register user");
    }

    return res.status(200).json(new ApiResponse(200, userCreated, "User Registered Successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    if (!username && !email) {
        throw new ApiError(400, "Please provde either username or email");
    }

    if (!password) {
        throw new ApiError(400, "Password field is empty");
    }

    const user = await User.findOne({
        $or: [{ username }, { email }]
    });

    if (!user) {
        throw new ApiError(404, "Login failed: User not found");
    }

    const passwordCorrect = await user.isPasswordCorrect(password);

    if (!passwordCorrect) {
        throw new ApiError(401, "Incorrect Password");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(200, {
                user: loggedInUser,
                accessToken,
                refreshToken
            }, "Logged in successfully")
        )
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined,
            }
        },
        {
            new: true
        }
    );

    return res
        .status(200)
        .clearCookie("asyncToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User logged out"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request");
    }
    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decodedToken?._id);
        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }
        if (incomingRefreshToken != user?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used");
        }

        const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

        return res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(new ApiResponse(200, { accessToken, refreshToken }, "Access token has been refreshed"));
    }
    catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }

});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        throw new ApiError(400, "Both old and new password are required");
    }
    const user = await User.findById(req.user?._id);

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Wrong current password");
    }

    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, req?.user, "Current user fetched successfully"));
})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullname, email, username } = req.body;
    if (!fullname || !email || !username) {
        throw new ApiError(400, "All fields are required");
    }
    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname,
                username,
                email
            }
        }, {
        new: true
    }).select("-password");

    return res.status(200).json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    console.log(req);
    const avatarLocalPath = req?.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Invalid avatar passed");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar?.url) {
        throw new ApiError(500, "Failed while uploading avatar on cloudinary");
    }

    const user = await User.findByIdAndUpdate(
        req?.user?._id,
        {
            $set: {
                avatar: avatar?.url,
            }
        },
        {
            new: true
        }
    ).select("-password");

    return res.status(200).json(new ApiResponse(200, user, "Avatar has been updated successfully"));
});

const updateCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req?.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Invalid coverImage passed");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage?.url) {
        throw new ApiError(500, "Failed while uploading coverImage on cloudinary");
    }

    const user = await User.findByIdAndUpdate(
        req?.user?._id,
        {
            $set: {
                coverImage: coverImage?.url,
            }
        },
        {
            new: true
        }
    ).select("-password");

    return res.status(200).json(new ApiResponse(200, user, "coverImage has been updated successfully"));
});

const subscribeToChannel = asyncHandler(async (req, res) => {
    const { username } = req.params;

    if (!username) {
        throw new ApiError(400, "Couldn't find any such channel");
    }

    const channel = await User.find({ username });

    if (!channel?.length) {
        throw new ApiError(400, "Couldn't find any such channel");
    }

    const subscriber = req.user?._id;

    const alreadySubscribed = await Subscription.findOne(
        {
            subscriber: subscriber,
            channel: channel[0]?._id
        }
    );

    if (alreadySubscribed) {
        throw new ApiError(400, "Already subscribed");
    }

    const subscription = await Subscription.create({
        subscriber: subscriber,
        channel: channel[0]?._id
    });

    const subscriptionCreated = await Subscription.findById(subscription?._id);

    if (!subscriptionCreated) {
        throw new ApiError(400, "Failed to subscribe to the channel");
    }

    return res.status(200).json(new ApiResponse(200, subscriptionCreated, "Subscribed successfully to the channel"));

});

const getChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;
    if (!username?.trim()) {
        throw new ApiError(400, "Username not found");
    }
    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase()   //find the channel entry in User schema
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",                  //get a list of users subscribed to this channel
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",                  //get a list of channels the user channel has subscribed to
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                subscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                        then: true,
                        else: false,
                    }
                }
            }
        },
        {
            $project: {
                fullname: 1,
                email: 1,
                username: 1,
                subscribedToCount: 1,
                subscribersCount: 1,
                avatar: 1,
                coverImage: 1,
                isSubscribed: 1,
            }
        }
    ]);

    if (!channel?.length) {
        throw new ApiError(400, "Channel doesn't exit");
    }

    return res.status(200).json(new ApiResponse(200, channel[0], "Channel details have been fetched"));
});

const getWatchHistory = asyncHandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user?._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullname: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }
    ]);

    return res.status(200).json(new ApiResponse(200, user[0].watchHistory, "Watch history has been fetched successfully"));
})

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateCoverImage,
    subscribeToChannel,
    getChannelProfile,
    getWatchHistory,
}