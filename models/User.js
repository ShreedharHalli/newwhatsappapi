const mongoose = require('mongoose');
const { isEmail } = require('validator');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: [true, 'Please enter a full name'],
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: [true, 'Please enter an email'],
        validate: [isEmail, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: [true, 'Please enter a Password'],
        minlength: [6, 'Minimum password length is 6 characters'],
    },
    AvailableCredits: {
        type: Number,
        default: 0,
    },
    connectedWhatsAppDevices: [{
        token: String,
        connectedWano: String,
    }],
    createdBy: {
        type: String,
        default: 'soniSir',
    },
    smsUserName: {
        type: String,
        default: '-',
    },
    smsKey: {
        type: String,
        default: '-',
    },
    smsAccUsg: {
        type: Number,
        default: '1',
    },
    entityId: {
        type: String,
        default: '-'
    },
    webHookUrl: {
        type: String,
        default: 'nowebhook'
    }
});

// fire a function before doc is saved to db
userSchema.pre('save', async function (next) {
    const userEmail = this.email;
    // let userAlreadyAvailable = await User.find( { "email": userEmail } );
    const existingUser = await this.constructor.findOne( { "email": userEmail } );
    if (existingUser) {
        next();
    }else {
    const salt = await bcrypt.genSalt();
    this.password = await bcrypt.hash(this.password, salt);
    next();
}
});

// static method to login user
userSchema.statics.login = async function (email, password) {
    const user = await this.findOne({ email });
    if (user) {
        const auth = await bcrypt.compare(password, user.password)
        if (auth) {
            return user;
        }
        throw Error('incorrect password');
    }
        throw Error('incorrect email');
};

const User = mongoose.model('user', userSchema);

module.exports = User;