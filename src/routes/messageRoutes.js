const express = require("express");

const router = express.Router();

const {
  createConversation,
  sendMessage,
  getMessages,
  getUserConversations,
} = require("../controllers/messageController");

router.post(
  "/conversation",
  createConversation
);

router.post(
  "/send",
  sendMessage
);

router.get(
  "/:conversationId",
  getMessages
);

router.get(
  "/user/:userId",
  getUserConversations
);


module.exports = router;