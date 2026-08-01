const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const MONGO_URI = 'mongodb+srv://aspecthjl_db_user:Hasan2323@cluster0.j2x6h70.mongodb.net/ametrchat?appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB bağlandı!'))
    .catch(err => console.log('Bağlantı hatası:', err));

// Kullanıcı Şeması
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    userTag: { type: String, required: true },
    fullTag: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    friends: { type: [String], default: [] },
    friendRequests: { type: [String], default: [] },
    blockedUsers: { type: [String], default: [] },
    groups: { type: Array, default: [] }
});
const User = mongoose.model('User', UserSchema);

// Mesaj Şeması
const MessageSchema = new mongoose.Schema({
    room: String,
    sender: String,
    text: String,
    time: String
});
const Message = mongoose.model('Message', MessageSchema);

// Rastgele Tag Üreteci
function generateTag() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// REST API Rotaları
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
        res.status(201).json({ message: 'Kayıt başarılı', fullTag });
    } catch (err) {
        res.status(400).json({ error: 'Kayıt başarısız' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let user;
        if (username.includes('#')) {
            user = await User.findOne({ fullTag: username, password });
        } else {
            user = await User.findOne({ username, password });
        }

        if (!user) {
            return res.status(400).json({ error: 'Hatalı kullanıcı adı veya şifre' });
        }
        res.status(200).json({ message: 'Giriş başarılı', fullTag: user.fullTag });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/get-user-data', async (req, res) => {
    try {
        const { fullTag } = req.body;
        const user = await User.findOne({ fullTag });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/send-request', async (req, res) => {
    try {
        const { senderFullTag, targetInput } = req.body;
        let targetFullTag = targetInput.startsWith('#') ? targetInput : `#${targetInput}`;
        
        const targetUser = await User.findOne({ fullTag: new RegExp(targetInput + '$', 'i') });
        if (!targetUser) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        if (targetUser.fullTag === senderFullTag) return res.status(400).json({ error: 'Kendine istek atamazsın' });

        if (targetUser.friendRequests.includes(senderFullTag) || targetUser.friends.includes(senderFullTag)) {
            return res.status(400).json({ error: 'İstek zaten var veya zaten arkadaşsınız' });
        }

        targetUser.friendRequests.push(senderFullTag);
        await targetUser.save();
        res.json({ message: 'İstek gönderildi' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/accept-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        const user = await User.findOne({ fullTag: userFullTag });
        const requester = await User.findOne({ fullTag: requesterFullTag });

        user.friendRequests = user.friendRequests.filter(f => f !== requesterFullTag);
        user.friends.push(requesterFullTag);
        requester.friends.push(userFullTag);

        await user.save();
        await requester.save();
        res.json({ message: 'Kabul edildi' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/reject-request', async (req, res) => {
    try {
        const { userFullTag, requesterFullTag } = req.body;
        await User.updateOne({ fullTag: userFullTag }, { $pull: { friendRequests: requesterFullTag } });
        res.json({ message: 'Reddedildi' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/remove-friend', async (req, res) => {
    try {
        const { userFullTag, friendFullTag } = req.body;
        await User.updateOne({ fullTag: userFullTag }, { $pull: { friends: friendFullTag } });
        await User.updateOne({ fullTag: friendFullTag }, { $pull: { friends: userFullTag } });
        res.json({ message: 'Arkadaşlıktan çıkarıldı' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/block-user', async (req, res) => {
    try {
        const { userFullTag, targetFullTag } = req.body;
        await User.updateOne({ fullTag: userFullTag }, { 
            $push: { blockedUsers: targetFullTag },
            $pull: { friends: targetFullTag }
        });
        await User.updateOne({ fullTag: targetFullTag }, { $pull: { friends: userFullTag } });
        res.json({ message: 'Engellendi' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/unblock-user', async (req, res) => {
    try {
        const { userFullTag, targetFullTag } = req.body;
        await User.updateOne({ fullTag: userFullTag }, { $pull: { blockedUsers: targetFullTag } });
        res.json({ message: 'Engel kaldırıldı' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/create-group', async (req, res) => {
    try {
        const { groupName, creator, members } = req.body;
        const allMembers = [...members, creator];
        
        for (const m of allMembers) {
            await User.updateOne({ fullTag: m }, { $push: { groups: { groupName, members: allMembers } } });
        }
        res.json({ message: 'Grup oluşturuldu' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/leave-group', async (req, res) => {
    try {
        const { fullTag, groupName } = req.body;
        await User.updateOne({ fullTag }, { $pull: { groups: { groupName } } });
        res.json({ message: 'Gruptan çıkıldı' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const { username, userTag, newPassword } = req.body;
        const fullTag = `${username}#${userTag}`;
        const user = await User.findOne({ fullTag });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

        user.password = newPassword;
        await user.save();
        res.json({ message: 'Şifre güncellendi' });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// Socket.IO Çevrim İçi Takibi
const onlineUsers = new Map(); // socket.id -> fullTag

io.on('connection', (socket) => {
    socket.on('register_user', (fullTag) => {
        onlineUsers.set(socket.id, fullTag);
        io.emit('update_online_users', Array.from(new Set(onlineUsers.values())));
    });

    socket.on('join room', async (room) => {
        socket.join(room);
        try {
            const messages = await Message.find({ room }).sort({ _id: 1 }).limit(50);
            socket.emit('load_room_messages', messages);
        } catch (err) {
            console.log('Mesaj yükleme hatası:', err);
        }
    });

    socket.on('chat message', async (data) => {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageData = { room: data.room, sender: data.sender, text: data.text, time };
        
        try {
            const newMessage = new Message(messageData);
            await newMessage.save();
            io.to(data.room).emit('chat message', messageData);
        } catch (err) {
            console.log('Mesaj kaydetme hatası:', err);
        }
    });

    socket.on('disconnect', () => {
        onlineUsers.delete(socket.id);
        io.emit('update_online_users', Array.from(new Set(onlineUsers.values())));
    });
});

server.listen(3000, () => {
    console.log('Sunucu 3000 portunda çalışıyor.');
});