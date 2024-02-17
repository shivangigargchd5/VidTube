import dbConnect from "./db/index.js";
import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config({ path: ".env" })

dbConnect()
    .then(() => {
        app.on("error", (err) => {
            console.log("Error listening to server", err);
            throw (err);
        });
        app.listen(process.env.PORT || 8000, () => {
            console.log(`Server running from port ${process.env.PORT || 8000}`)
        })
    })
    .catch((err) => {
        console.log("DB Connection Failed", err);
    });