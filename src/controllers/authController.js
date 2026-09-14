// src/controllers/authController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// POST /api/auth/signup
exports.signup = async (req, res) => {
    try {
        const { email, username, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email và password là bắt buộc" });
        }

        const existed = await User.findOne({ email });
        if (existed) {
            return res.status(400).json({ message: "Email đã được sử dụng" });
        }

        const hashed = await bcrypt.hash(password, 10);

        const user = await User.create({
            email,
            username,
            password: hashed,
            role: "user"
        });

        res.status(201).json({
            message: "Tạo tài khoản thành công",
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// POST /api/auth/login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Sai email hoặc mật khẩu" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: "Sai email hoặc mật khẩu" });

        if (user.isLocked) {
            return res.status(403).json({ message: "Tài khoản đã bị khoá" });
        }

        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            message: "Đăng nhập thành công",
            token,
            user: {
                id: user._id,
                email: user.email,
                username: user.username,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

// GET /api/auth/me
exports.me = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password");
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: "Lỗi server" });
    }
};
