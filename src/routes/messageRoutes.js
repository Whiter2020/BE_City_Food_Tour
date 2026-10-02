const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
    createConversation,
    sendMessage,
    getMessages,
    getMyConversations,
} = require("../controllers/messageController");

const router = express.Router();

router.use(authMiddleware);
router.post("/conversations", createConversation);
router.post("/send", sendMessage);
router.get("/mine", getMyConversations);
router.get("/:conversationId", getMessages);

module.exports = router;
