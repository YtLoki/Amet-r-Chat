const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Bağlantısı
mongoose.connect('mongodb://localhost:27017/ametrchat', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB Bağlandı')).catch(err => console.log(err));

// Mongoose Modelleri
const userSchema = new mongoose.Schema({
    username: String,
    userTag: String,
    fullTag: { type: String, unique: true },
    password: String,
    friends: [String],
    friendRequests: [String],
    blockedUsers: [String],
    groups: [{ groupName: String }]
});

const messageSchema = new mongoose.Schema({
    room: String,
    sender: String,
    text: String,
    time: String
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

function generateTag() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// --- API ENDPOINTS ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        let userTag = generateTag();
        let fullTag = `${username}#${userTag}`;
        
        while (await User.findOne({ fullTag })) {
            userTag = generateTag();
            fullTag = `${username}#${userTag}`;
        }

        const newUser = new User({ username, userTag, fullTag, password });
        await newUser.save();
        res.json({ fullTag });
    } catch (err) {
        res.status(400).json({ error: 'Kayıt olurken hata oluştu.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let user = await User.findOne({ fullTag: username, password });
        if (!user) {
            user = await User.findOne({ username, password });
        }
        if (!user) return res.status(400).json({ error: 'Geçersiz kullanıcı adı veya şifre.' });
        res.json({ fullTag: user.fullTag });
    } catch (err) {
        res.status(400).json({ error: 'Giriş yapılırken hata oluştu.' });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { username, userTag, newPassword } = req.body;
        const fullTag = userTag.startsWith('#') ? `${username}${userTag}` : `${username}#${userTag}`;
        const user = await User.findOne({ fullTag });
        if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
        user.password = newPassword;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/get-user-data', async (req, res) => {
    try {
        const { fullTag } = req.body;
        const user = await User.findOne({ fullTag });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        res.json({
            friends: user.friends,
            friendRequests: user.friendRequests,
            blockedUsers: user.blockedUsers,
            groups: user.groups
        });
    } catch (err) {
        res.status(400).json({ error: 'Veri alınamadı.' });
    }
});

app.post('/api/send-request', async (req, res) => {
    try {
        const { senderFullTag, targetInput } = req.body;
        let targetUser = await User.findOne({ fullTag: targetInput });
        if (!targetUser && !targetInput.includes('#')) {
            targetUser = await User.findOne({ username: targetInput });
        }
        
        if (!targetUser) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        if (targetUser.fullTag === senderFullTag) return res.status(400).json({ error: 'Kendine istek atamazsın.' });
        if (targetUser.blockedUsers.includes(senderFullTag)) return res.status(400).json({ error: 'Bu kullanıcı tarafından engellenmişsiniz.' });
        if (targetUser.friends.includes(senderFullTag)) return res.status(400).json({ error: 'Zaten arkadaşsınız.' });
        if (targetUser.friendRequests.includes(senderFullTag)) return res.status(400).json({ error: 'Zaten istek gönderilmiş.' });

        targetUser.friendRequests.push(senderFullTag);
        await targetUser.save();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İstek gönderilemedi.' });
    }
});

app.post('/api/accept-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        const user = await User.findOne({ fullTag: userFullTag });
        const requester = await User.findOne({ fullTag: requesterFullTag });

        if (!user || !requester) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

        user.friendRequests = user.friendRequests.filter(f => f !== requesterFullTag);
        if (!user.friends.includes(requesterFullTag)) user.friends.push(requesterFullTag);
        if (!requester.friends.includes(userFullTag)) requester.friends.push(userFullTag);

        await user.save();
        await requester.save();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/reject-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        const user = await User.findOne({ fullTag: userFullTag });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        user.friendRequests = user.friendRequests.filter(f => f !== requesterFullTag);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/remove-friend', async (req, res) => {
    try {
        const { userFullTag, friendFullTag } = req.body;
        const user = await User.findOne({ fullTag: userFullTag });
        const friend = await User.findOne({ fullTag: friendFullTag });

        if (user) {
            user.friends = user.friends.filter(f => f !== friendFullTag);
            await user.save();
        }
        if (friend) {
            friend.friends = friend.friends.filter(f => f !== userFullTag);
            await friend.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/block-user', async (req, res) => {
    try {
        const { userFullTag, targetFullTag } = req.body;
        const user = await User.findOne({ fullTag: userFullTag });
        const target = await User.findOne({ fullTag: targetFullTag });

        if (user) {
            user.friends = user.friends.filter(f => f !== targetFullTag);
            if (!user.blockedUsers.includes(targetFullTag)) user.blockedUsers.push(targetFullTag);
            await user.save();
        }
        if (target) {
            target.friends = target.friends.filter(f => f !== userFullTag);
            await target.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/unblock-user', async (req, res) => {
    try {
        const { userFullTag, targetFullTag } = req.body;
        const user = await User.findOne({ fullTag: userFullTag });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        
        user.blockedUsers = user.blockedUsers.filter(b => b !== targetFullTag);
        if (!user.friends.includes(targetFullTag)) {
            user.friends.push(targetFullTag);
        }
        await user.save();

        const target = await User.findOne({ fullTag: targetFullTag });
        if (target && !target.friends.includes(userFullTag)) {
            target.friends.push(userFullTag);
            await target.save();
        }

        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/create-group', async (req, res) => {
    try {
        const { groupName, creator, members } = req.body;
        if (!groupName) return res.status(400).json({ error: 'Grup adı gereklidir.' });

        const allMembers = [creator, ...members];
        for (const mTag of allMembers) {
            const u = await User.findOne({ fullTag: mTag });
            if (u) {
                if (!u.groups.some(g => g.groupName === groupName)) {
                    u.groups.push({ groupName });
                    await u.save();
                }
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Grup kurulamadı.' });
    }
});

app.post('/api/leave-group', async (req, res) => {
    try {
        const { fullTag, groupName } = req.body;
        const user = await User.findOne({ fullTag });
        if (user) {
            user.groups = user.groups.filter(g => g.groupName !== groupName);
            await user.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Gruptan çıkılamadı.' });
    }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('join room', async (room) => {
        socket.join(room);
        try {
            const messages = await Message.find({ room }).sort({ _id: 1 }).limit(100);
            socket.emit('load_room_messages', messages);
        } catch (err) {
            console.log('Mesajlar yüklenemedi:', err);
        }
    });

    socket.on('chat message', async (data) => {
        const { room, sender, text } = data;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageData = { room, sender, text, time };

        try {
            const newMessage = new Message(messageData);
            await newMessage.save();
            io.to(room).emit('chat message', messageData);
        } catch (err) {
            console.log('Mesaj kaydedilemedi:', err);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});