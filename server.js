const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    sender: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Yardımcı Fonksiyonlar
async function generateUniqueTag() {
    let tag, exists;
    do {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        tag = `#${randomNum}`;
        exists = await User.findOne({ userTag: tag });
    } while (exists);
    return tag;
}

function parseTag(fullTag) {
    if (!fullTag || !fullTag.includes('#')) return { username: fullTag, userTag: '' };
    const parts = fullTag.split('#');
    return { username: parts[0], userTag: '#' + parts[1] };
}

// API ENDPOINTS

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Tüm alanları doldurun." });

        const userTag = await generateUniqueTag();
        const fullTag = `${username}${userTag}`;
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            username,
            userTag,
            password: hashedPassword,
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
            const { username: uName, userTag } = parseTag(username);
            user = await User.findOne({ username: uName, userTag });
        } else {
            user = await User.findOne({ username });
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: "Geçersiz kullanıcı adı veya şifre." });
        }

        const fullTag = `${user.username}${user.userTag}`;
        res.json({ success: true, fullTag, userTag: user.userTag });
    } catch (err) {
        res.status(500).json({ error: "Giriş yapılırken bir hata oluştu." });
    }
});

app.post('/api/get-user-data', async (req, res) => {
    try {
        const { fullTag } = req.body;
        const { username, userTag } = parseTag(fullTag);

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
        const targetUser = await User.findOne({ userTag: targetInput.trim() });

        if (!targetUser) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

        const targetFullTag = `${targetUser.username}${targetUser.userTag}`;
        if (senderFullTag === targetFullTag) return res.status(400).json({ error: "Kendine istek atamazsın." });

        if (targetUser.friendRequests.includes(senderFullTag)) return res.status(400).json({ error: "Zaten istek gönderilmiş." });

        targetUser.friendRequests.push(senderFullTag);
        await targetUser.save();

        io.to(targetFullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "İstek gönderilemedi." });
    }
});

app.post('/api/accept-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        const u = parseTag(userFullTag);
        const r = parseTag(requesterFullTag);

        const user = await User.findOne({ username: u.username, userTag: u.userTag });
        const requester = await User.findOne({ username: r.username, userTag: r.userTag });

        if (user && requester) {
            user.friendRequests = user.friendRequests.filter(tag => tag !== requesterFullTag);
            if (!user.friends.includes(requesterFullTag)) user.friends.push(requesterFullTag);
            if (!requester.friends.includes(userFullTag)) requester.friends.push(userFullTag);

            await user.save();
            await requester.save();

            io.to(requesterFullTag).emit('update_data');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "İstek kabul edilemedi." });
    }
});

app.post('/api/create-group', async (req, res) => {
    try {
        const { groupName, creator, members } = req.body;
        if (!groupName) return res.status(400).json({ error: "Grup adı gerekli." });

        const allMembers = Array.from(new Set([creator, ...(members || [])]));

        for (let memberTag of allMembers) {
            const m = parseTag(memberTag);
            const memberUser = await User.findOne({ username: m.username, userTag: m.userTag });
            if (memberUser && !memberUser.groups.some(g => g.groupName === groupName)) {
                memberUser.groups.push({ groupName, adminTag: creator });
                await memberUser.save();
                io.to(memberTag).emit('update_data');
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Grup oluşturulamadı." });
    }
});

// SOCKET.IO GERÇEK ZAMANLI SOHBET
io.on('connection', (socket) => {

    socket.on('register_user', (fullTag) => {
        socket.join(fullTag);
    });

    socket.on('join room', async (room) => {
        socket.join(room);
        try {
            const messages = await Message.find({ room }).sort({ timestamp: 1 }).limit(100);
            const formattedMessages = messages.map(m => {
                const date = new Date(m.timestamp);
                const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
                return {
                    room: m.room,
                    sender: m.sender,
                    text: m.content,
                    time: timeStr
                };
            });
            socket.emit('load_room_messages', formattedMessages);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('chat message', async (data) => {
        try {
            const newMessage = new Message({
                room: data.room,
                sender: data.sender,
                content: data.text
            });
            await newMessage.save();

            const date = new Date();
            const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');

            io.to(data.room).emit('chat message', {
                room: data.room,
                sender: data.sender,
                text: data.text,
                time: timeStr
            });
        } catch (err) {
            console.error(err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} üzerinde aktif.`));