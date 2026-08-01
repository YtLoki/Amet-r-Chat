const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://HasanDemir:tOtzO1EFvesAwQl4@cluster0.yfvquev.mongodb.net/ametrchat?retryWrites=true&w=majority';

async function clearDb() {
    try {
        await mongoose.connect(MONGO_URI);
        await mongoose.connection.db.dropDatabase();
        console.log('ametrchat veritabanı başarıyla silindi!');
        process.exit();
    } catch (err) {
        console.error('Hata oluştu:', err);
        process.exit(1);
    }
}

clearDb();