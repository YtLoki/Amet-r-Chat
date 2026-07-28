const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

// Ana dizin yönlendirmesi (public_index.html)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public_index.html');
});

// MongoDB Bağlantısı
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/darkchat";

mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB bağlantısı başarılı."))
    .catch(err => console.error("MongoDB bağlantı hatası:", err));

// Veritabanı Şemaları
const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    userTag: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    friends: [String],
    friendRequests: [String],
    blockedUsers: [String],
    groups: [{ groupName: String, adminTag: String }]
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
    room: String,
    username: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

async function generateUniqueTag(username) {
    let tag, exists;
    do {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        tag = `#${randomNum}`;
        exists = await User.findOne({ userTag: tag });
    } while (exists);
    return tag;
}

// API Uç Noktaları
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Tüm alanları doldurun." });
        }

        const userTag = await generateUniqueTag(username);
        const fullTag = `${username}${userTag}`;

        const existingUser = await User.findOne({ userTag });
        if (existingUser) {
            return res.status(400).json({ error: "Bu ID zaten kullanımda, tekrar deneyin." });
        }

        const newUser = new User({
            username,
            userTag,
            password,
            friends: [],
            friendRequests: [],
            blockedUsers: [],
            groups: []
        });

        await newUser.save();
        res.json({ success: true, fullTag, userTag });
    } catch (err) {
        res.status(500).json({ error: "Kayıt olurken bir hata oluştu." });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let user;
        if (username.includes('#')) {
            const parts = username.split('#');
            user = await User.findOne({ username: parts[0], userTag: '#' + parts[1], password });
        } else {
            user = await User.findOne({ username, password });
        }

        if (!user) {
            return res.status(400).json({ error: "Geçersiz kullanıcı adı veya şifre." });
        }

        const fullTag = `${user.username}${user.userTag}`;
        res.json({ success: true, fullTag, userTag: user.userTag });
    } catch (err) {
        res.status(500).json({ error: "Giriş yapılırken bir hata oluştu." });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { username, userTag, newPassword } = req.body;
        const user = await User.findOne({ username, userTag });
        if (!user) {
            return res.status(404).json({ error: "Kullanıcı bulunamadı veya ID hatalı." });
        }

        user.password = newPassword;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Şifre sıfırlanamadı." });
    }
});

app.post('/api/get-user-data', async (req, res) => {
    try {
        const { fullTag } = req.body;
        const parts = fullTag.split('#');
        const username = parts[0];
        const userTag = '#' + parts[1];

        const user = await User.findOne({ username, userTag });
        if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        res.json({
            userTag: user.userTag,
            friends: user.friends,
            friendRequests: user.friendRequests,
            blockedUsers: user.blockedUsers,
            groups: user.groups
        });
    } catch (err) {
        res.status(500).json({ error: "Veriler alınamadı." });
    }
});

app.post('/api/send-request', async (req, res) => {
    try {
        const { senderFullTag, targetInput } = req.body;
        const cleanTarget = targetInput.trim();

        const targetUser = await User.findOne({ userTag: cleanTarget });
        if (!targetUser) {
            return res.status(404).json({ error: "Bu ID'ye sahip kullanıcı bulunamadı." });
        }

        const targetFullTag = `${targetUser.username}${targetUser.userTag}`;
        if (senderFullTag === targetFullTag) {
            return res.status(400).json({ error: "Kendine istek atamazsın." });
        }

        const senderParts = senderFullTag.split('#');
        const senderUser = await User.findOne({ username: senderParts[0], userTag: '#' + senderParts[1] });

        if (senderUser.friends.includes(targetFullTag)) {
            return res.status(400).json({ error: "Bu kullanıcı zaten arkadaşınız." });
        }

        if (targetUser.friendRequests.includes(senderFullTag)) {
            return res.status(400).json({ error: "Zaten istek gönderilmiş." });
        }

        if (targetUser.blockedUsers.includes(senderFullTag)) {
            return res.status(400).json({ error: "Bu kullanıcıya istek gönderemezsiniz." });
        }

        targetUser.friendRequests.push(senderFullTag);
        await targetUser.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "İstek gönderilemedi." });
    }
});

app.post('/api/accept-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        const uParts = userFullTag.split('#');
        const user = await User.findOne({ username: uParts[0], userTag: '#' + uParts[1] });

        const rParts = requesterFullTag.split('#');
        const requester = await User.findOne({ username: rParts[0], userTag: '#' + rParts[1] });

        if (user && requester) {
            user.friendRequests = user.friendRequests.filter(tag => tag !== requesterFullTag);
            if (!user.friends.includes(requesterFullTag)) user.friends.push(requesterFullTag);
            if (!requester.friends.includes(userFullTag)) requester.friends.push(userFullTag);

            await user.save();
            await requester.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "İstek kabul edilemedi." });
    }
});

app.post('/api/reject-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        const uParts = userFullTag.split('#');
        const user = await User.findOne({ username: uParts[0], userTag: '#' + uParts[1] });

        if (user) {
            user.friendRequests = user.friendRequests.filter(tag => tag !== requesterFullTag);
            await user.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "İstek reddedilemedi." });
    }
});

app.post('/api/remove-friend', async (req, res) => {
    try {
        const { userFullTag, friendTag } = req.body;
        const uParts = userFullTag.split('#');
        const user = await User.findOne({ username: uParts[0], userTag: '#' + uParts[1] });

        const fParts = friendTag.split('#');
        const friend = await User.findOne({ username: fParts[0], userTag: '#' + fParts[1] });

        if (user) user.friends = user.friends.filter(t => t !== friendTag);
        if (friend) friend.friends = friend.friends.filter(t => t !== userFullTag);

        if (user) await user.save();
        if (friend) await friend.save();

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Arkadaş silinemedi." });
    }
});

app.post('/api/block-user', async (req, res) => {
    try {
        const { userFullTag, blockedTag } = req.body;
        const uParts = userFullTag.split('#');
        const user = await User.findOne({ username: uParts[0], userTag: '#' + uParts[1] });

        if (user) {
            user.friends = user.friends.filter(t => t !== blockedTag);
            if (!user.blockedUsers.includes(blockedTag)) user.blockedUsers.push(blockedTag);
            await user.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Kullanıcı engellenemedi." });
    }
});

app.post('/api/unblock-user', async (req, res) => {
    try {
        const { userFullTag, blockedTag } = req.body;
        const uParts = userFullTag.split('#');
        const user = await User.findOne({ username: uParts[0], userTag: '#' + uParts[1] });

        if (user) {
            user.blockedUsers = user.blockedUsers.filter(t => t !== blockedTag);
            await user.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Engel kaldırılamadı." });
    }
});

app.post('/api/create-group', async (req, res) => {
    try {
        const { groupName, adminTag, selectedMembers } = req.body;
        if (!groupName) return res.status(400).json({ error: "Grup adı gerekli." });

        const allMembers = [adminTag, ...selectedMembers];
        for (let memberTag of allMembers) {
            const mParts = memberTag.split('#');
            const memberUser = await User.findOne({ username: mParts[0], userTag: '#' + mParts[1] });
            if (memberUser) {
                memberUser.groups.push({ groupName, adminTag });
                await memberUser.save();
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Grup oluşturulamadı." });
    }
});

app.post('/api/leave-group', async (req, res) => {
    try {
        const { groupName, userFullTag } = req.body;
        const uParts = userFullTag.split('#');
        const user = await User.findOne({ username: uParts[0], userTag: '#' + uParts[1] });

        if (user) {
            user.groups = user.groups.filter(g => g.groupName !== groupName);
            await user.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Gruptan çıkılamadı." });
    }
});

// Socket.io
io.on('connection', (socket) => {
    socket.on('join room', async (room) => {
        socket.join(room);
        try {
            const messages = await Message.find({ room }).sort({ timestamp: 1 }).limit(50);
            socket.emit('load room messages', { room, messages });
        } catch (err) {
            console.error("Mesajlar yüklenirken hata:", err);
        }
    });

    socket.on('chat message', async (data) => {
        try {
            const newMessage = new Message({
                room: data.room,
                username: data.senderTag,
                content: data.text
            });
            await newMessage.save();

            io.to(data.room).emit('chat message', {
                room: data.room,
                username: data.senderTag,
                content: data.text
            });
        } catch (err) {
            console.error("Mesaj kaydedilemedi:", err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});