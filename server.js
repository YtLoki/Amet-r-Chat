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
app.use(express.static(__dirname));

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://HasanDemir:tOtzO1EFvesAwQl4@cluster0.yfvquev.mongodb.net/ametrchat?appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Bağlandı'))
    .catch(err => console.log('DB Bağlantı Hatası:', err));

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public_index.html'));
});

app.post('/api/register', async (req, res) => {
    try {
        const username = req.body.username ? req.body.username.trim() : '';
        const password = req.body.password;
        let userTag = generateTag();
        let fullTag = `${username}#${userTag}`;
        
        while (await User.findOne({ fullTag })) {
            userTag = generateTag();
            fullTag = `${username}#${userTag}`;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, userTag, fullTag, password: hashedPassword });
        await newUser.save();
        res.json({ fullTag });
    } catch (err) {
        res.status(400).json({ error: 'Kayıt olurken hata oluştu.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const input = req.body.username ? req.body.username.trim() : '';
        const password = req.body.password;
        
        let user;
        if (input.includes('#')) {
            user = await User.findOne({ fullTag: new RegExp(`^${input}$`, 'i') });
        } else {
            user = await User.findOne({ username: new RegExp(`^${input}$`, 'i') });
        }

        if (!user) return res.status(400).json({ error: 'Geçersiz kullanıcı adı/tag veya şifre.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Geçersiz kullanıcı adı/tag veya şifre.' });

        res.json({ fullTag: user.fullTag });
    } catch (err) {
        res.status(400).json({ error: 'Giriş yapılırken hata oluştu.' });
    }
});

app.post('/api/forgot-password', async (req, res) => {
    try {
        const username = req.body.username ? req.body.username.trim() : '';
        const userTag = req.body.userTag ? req.body.userTag.trim() : '';
        const newPassword = req.body.newPassword;
        const fullTag = userTag.startsWith('#') ? `${username}${userTag}` : `${username}#${userTag}`;
        
        const user = await User.findOne({ fullTag: new RegExp(`^${fullTag}$`, 'i') });
        if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı.' });
        
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/get-user-data', async (req, res) => {
    try {
        const fullTag = req.body.fullTag ? req.body.fullTag.trim() : '';
        const user = await User.findOne({ fullTag: new RegExp(`^${fullTag}$`, 'i') });
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
        const senderFullTag = req.body.senderFullTag ? req.body.senderFullTag.trim() : '';
        const targetInput = req.body.targetInput ? req.body.targetInput.trim() : '';
        
        if (!targetInput.includes('#')) {
            return res.status(400).json({ error: 'Aynı isimde birden fazla kullanıcı olabilir, lütfen tam tag (Örn: İsim#1234) girin.' });
        }
        
        const targetUser = await User.findOne({ fullTag: new RegExp(`^${targetInput}$`, 'i') });
        
        if (!targetUser) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        if (targetUser.fullTag === senderFullTag) return res.status(400).json({ error: 'Kendine istek atamazsın.' });
        if (targetUser.blockedUsers.includes(senderFullTag)) return res.status(400).json({ error: 'Bu kullanıcı tarafından engellenmişsiniz.' });
        if (targetUser.friends.includes(senderFullTag)) return res.status(400).json({ error: 'Zaten arkadaşsınız.' });
        if (targetUser.friendRequests.includes(senderFullTag)) return res.status(400).json({ error: 'Zaten istek gönderilmiş.' });

        targetUser.friendRequests.push(senderFullTag);
        await targetUser.save();

        io.to(targetUser.fullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İstek gönderilemedi.' });
    }
});

app.post('/api/accept-request', async (req, res) => {
    try {
        const userFullTag = req.body.userFullTag ? req.body.userFullTag.trim() : '';
        const requesterFullTag = req.body.requesterFullTag ? req.body.requesterFullTag.trim() : '';
        
        const user = await User.findOne({ fullTag: new RegExp(`^${userFullTag}$`, 'i') });
        const requester = await User.findOne({ fullTag: new RegExp(`^${requesterFullTag}$`, 'i') });

        if (!user || !requester) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

        user.friendRequests = user.friendRequests.filter(f => f !== requesterFullTag);
        if (!user.friends.includes(requesterFullTag)) user.friends.push(requesterFullTag);
        if (!requester.friends.includes(userFullTag)) requester.friends.push(userFullTag);

        await user.save();
        await requester.save();

        io.to(requesterFullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/reject-request', async (req, res) => {
    try {
        const userFullTag = req.body.userFullTag ? req.body.userFullTag.trim() : '';
        const requesterFullTag = req.body.requesterFullTag ? req.body.requesterFullTag.trim() : '';
        
        const user = await User.findOne({ fullTag: new RegExp(`^${userFullTag}$`, 'i') });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        user.friendRequests = user.friendRequests.filter(f => f !== requesterFullTag);
        await user.save();

        io.to(requesterFullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/remove-friend', async (req, res) => {
    try {
        const userFullTag = req.body.userFullTag ? req.body.userFullTag.trim() : '';
        const friendFullTag = req.body.friendFullTag ? req.body.friendFullTag.trim() : '';
        
        const user = await User.findOne({ fullTag: new RegExp(`^${userFullTag}$`, 'i') });
        const friend = await User.findOne({ fullTag: new RegExp(`^${friendFullTag}$`, 'i') });

        if (user) {
            user.friends = user.friends.filter(f => f !== friendFullTag);
            await user.save();
        }
        if (friend) {
            friend.friends = friend.friends.filter(f => f !== userFullTag);
            await friend.save();
        }

        io.to(friendFullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/block-user', async (req, res) => {
    try {
        const userFullTag = req.body.userFullTag ? req.body.userFullTag.trim() : '';
        const targetFullTag = req.body.targetFullTag ? req.body.targetFullTag.trim() : '';
        
        const user = await User.findOne({ fullTag: new RegExp(`^${userFullTag}$`, 'i') });
        const target = await User.findOne({ fullTag: new RegExp(`^${targetFullTag}$`, 'i') });

        if (user) {
            user.friends = user.friends.filter(f => f !== targetFullTag);
            if (!user.blockedUsers.includes(targetFullTag)) user.blockedUsers.push(targetFullTag);
            await user.save();
        }
        if (target) {
            target.friends = target.friends.filter(f => f !== userFullTag);
            await target.save();
        }

        io.to(targetFullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/unblock-user', async (req, res) => {
    try {
        const userFullTag = req.body.userFullTag ? req.body.userFullTag.trim() : '';
        const targetFullTag = req.body.targetFullTag ? req.body.targetFullTag.trim() : '';
        
        const user = await User.findOne({ fullTag: new RegExp(`^${userFullTag}$`, 'i') });
        if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
        
        user.blockedUsers = user.blockedUsers.filter(b => b !== targetFullTag);
        if (!user.friends.includes(targetFullTag)) {
            user.friends.push(targetFullTag);
        }
        await user.save();

        const target = await User.findOne({ fullTag: new RegExp(`^${targetFullTag}$`, 'i') });
        if (target && !target.friends.includes(userFullTag)) {
            target.friends.push(userFullTag);
            await target.save();
        }

        io.to(targetFullTag).emit('update_data');
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'İşlem başarısız.' });
    }
});

app.post('/api/create-group', async (req, res) => {
    try {
        const groupName = req.body.groupName ? req.body.groupName.trim() : '';
        const creator = req.body.creator ? req.body.creator.trim() : '';
        const members = req.body.members || [];
        if (!groupName) return res.status(400).json({ error: 'Grup adı gereklidir.' });

        const allMembers = [creator, ...members];
        for (const mTag of allMembers) {
            const u = await User.findOne({ fullTag: new RegExp(`^${mTag.trim()}$`, 'i') });
            if (u) {
                if (!u.groups.some(g => g.groupName === groupName)) {
                    u.groups.push({ groupName });
                    await u.save();
                    io.to(u.fullTag).emit('update_data');
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
        const fullTag = req.body.fullTag ? req.body.fullTag.trim() : '';
        const groupName = req.body.groupName ? req.body.groupName.trim() : '';
        const user = await User.findOne({ fullTag: new RegExp(`^${fullTag}$`, 'i') });
        if (user) {
            user.groups = user.groups.filter(g => g.groupName !== groupName);
            await user.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Gruptan çıkılamadı.' });
    }
});

io.on('connection', (socket) => {
    socket.on('register_user', (fullTag) => {
        if (fullTag) {
            socket.join(fullTag.trim());
        }
    });

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
        const time = new Intl.DateTimeFormat('tr-TR', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(new Date());
        
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