const asyncHandler = (fnc) => async (req, res, next) => {
    try {
        await fnc(req, res, next);
    }
    catch (err) {
        res.status(err.code || 500).json({
            success: false,
            message: err.message
        })
    }
};

export { asyncHandler }