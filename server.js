const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const authRoutes = require("./src/routes/authRoutes");
const restaurantRoutes = require("./src/routes/restaurantRoutes");
const userRoutes = require("./src/routes/userRoutes");
const uploadRoutes = require("./src/routes/uploadRoutes");
const reviewRoutes = require("./src/routes/reviewRoutes");

const app = express();

app.use(cors());
app.use(express.json());



app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/users", userRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api", reviewRoutes);

app.get("/api/test", (req, res) => {
    res.json({ message: "BE ok" });
});

const PORT = process.env.PORT || 5000;

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
        console.log("✅ MongoDB connected");
        app.listen(PORT, () => {
            console.log(`✅ Backend running at http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error("❌ MongoDB error:", err);
    });
