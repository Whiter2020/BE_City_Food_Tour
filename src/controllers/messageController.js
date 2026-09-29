const Conversation = require("../models/Conversation");
const Message = require("../models/Message");


// =======================================
// 1. Tạo conversation giữa User và Restaurant
// POST /api/messages/conversation
// =======================================
exports.createConversation = async (req, res) => {
  try {
    const { userId, restaurantId } = req.body;

    if (!userId || !restaurantId) {
      return res.status(400).json({
        message: "userId và restaurantId là bắt buộc",
      });
    }


    // Kiểm tra conversation đã tồn tại chưa
    let conversation = await Conversation.findOne({
      userId,
      restaurantId,
    });


    // Nếu chưa có thì tạo mới
    if (!conversation) {
      conversation = await Conversation.create({
        userId,
        restaurantId,
        lastMessage: "",
      });
    }


    res.status(201).json({
      message: "Tạo conversation thành công",
      conversation,
    });


  } catch (error) {
    console.error("Create conversation error:", error);

    res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};



// =======================================
// 2. Gửi message
// POST /api/messages/send
// =======================================
exports.sendMessage = async (req, res) => {
  try {
    const {
      conversationId,
      senderId,
      senderType,
      content,
    } = req.body;


    if (
      !conversationId ||
      !senderId ||
      !senderType ||
      !content
    ) {
      return res.status(400).json({
        message: "Thiếu dữ liệu gửi tin nhắn",
      });
    }



    // Kiểm tra conversation tồn tại
    const conversation = await Conversation.findById(
      conversationId
    );


    if (!conversation) {
      return res.status(404).json({
        message: "Không tìm thấy conversation",
      });
    }



    // Tạo message mới
    const message = await Message.create({
      conversationId,
      senderId,
      senderType,
      content,
    });



    // Update tin nhắn cuối cùng
    await Conversation.findByIdAndUpdate(
      conversationId,
      {
        lastMessage: content,
        lastMessageAt: new Date(),
      }
    );



    res.status(201).json({
      message: "Gửi tin nhắn thành công",
      data: message,
    });



  } catch (error) {

    console.error("Send message error:", error);

    res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};




// =======================================
// 3. Lấy lịch sử chat
// GET /api/messages/:conversationId
// =======================================
exports.getMessages = async (req, res) => {

  try {

    const { conversationId } = req.params;


    const messages = await Message.find({
      conversationId,
    })
      .sort({
        createdAt: 1,
      });



    res.status(200).json({
      total: messages.length,
      messages,
    });



  } catch (error) {

    console.error("Get messages error:", error);

    res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }

};




// =======================================
// 4. Lấy danh sách conversation của User
// GET /api/messages/user/:userId
// =======================================
exports.getUserConversations = async (req, res) => {

  try {

    const { userId } = req.params;


    const conversations = await Conversation.find({
      userId,
    })
      .populate(
        "restaurantId",
        "name image address"
      )
      .sort({
        updatedAt: -1,
      });



    res.status(200).json({
      total: conversations.length,
      conversations,
    });



  } catch (error) {

    console.error(
      "Get conversations error:",
      error
    );


    res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }

};