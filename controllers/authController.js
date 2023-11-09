const User = require('../models/User');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const axios = require('axios');


// handle errors
const handleErrors = (err) => {
    let errors = { email: '', password: '' };

    //login stage
    // incorrect email
    if (err.message === 'incorrect email') {
        errors.email = 'that email is not registered';
    }

    // incorrect password
    if (err.message === 'incorrect password') {
        errors.password = 'that password is incorrect';
    }


    //duplicate email error code
    if (err.code === 11000) {
        errors.email = 'that email already exists';
        return errors;
    }


    //validation errors
    if (err.message.includes('user validation failed')) {
        Object.values(err.errors).forEach(({properties}) => {
            errors[properties.path] = properties.message;
        }
    )}
    return errors;

};

const maxAge = 3 * 24 * 60 * 60;
const createToken = (id) => {
    return jwt.sign({ id }, 'mayu secret', {
        expiresIn: maxAge
    });
};


module.exports.register_post = async (req, res) => {
    const { fullName, email, password, smsUserName, smsKey, smsAccUsg, entityId } = req.body;
    try {
        const user = await User.create({fullName, email, password, smsUserName, smsKey, smsAccUsg, entityId});
        const token = createToken(user._id)
        res.cookie('jwt', token, smsUserName, smsKey, entityId, { httpOnly: true, maxAge: maxAge * 1000});
        res.status(200).json({ user: user._id});
    } catch (error) {
        console.log(error);
        const errors = handleErrors(error);
        res.status(400).json({ errors });
    }
};



module.exports.login_get = (req, res) => {
    res.render('login')
};

module.exports.customerPage_get = (req, res) => {
    res.render('customerpage')
};

module.exports.login_post = async (req, res) => {
    let { email, password } = req.body;

    try {
        const user = await User.login(email, password);
        const token = createToken(user._id)
        res.cookie('jwt', token, { httpOnly: true, maxAge: maxAge * 1000});
        res.status(200).json({ user: user._id, email: user.email });
    } catch (error) {
        console.log(error);
        let errors = handleErrors(error);
        res.status(400).json({errors});
    }

};

module.exports.logout_get = (req, res) => {
    res.cookie('jwt', '', { httpOnly: true, maxAge: 1}); // in short we are removing the cookie
    res.redirect('/login');
};

module.exports.soniSirPage_get = (req, res) => {
    res.render('sonisirpage')
};



module.exports.issuecreditsendpoint_post = async (req, res) => {
    let { customerid, credits } = req.body;
    try {
        const soniSirDoc = await User.findOne({ _id: '649d5066643927b562115c98' }); // SONI SIR DOCUMENT ID
        if (soniSirDoc && soniSirDoc.AvailableCredits >= credits) { // Check if user exists and AvailableCredits is greater than requested credits
            const updatedCredits = await User.updateOne({ _id: customerid }, { $inc: { AvailableCredits: credits } });
            res.status(200).json(updatedCredits);
        } else {
            res.status(400).json({ message: "Insufficient Credits Available" });
        }
    } catch (error) {
        res.status(400).json(error.message);
    }
};



module.exports.deletecustomer_post = async (req, res) => {
    let { customerId } = req.body;
    const docID = customerId['0'];
try {
    const deletedCustomer = await User.findByIdAndDelete(docID);
    if (deletedCustomer) {
      console.log('Deleted Customer:', deletedCustomer);
      res.json({ message: 'Customer deleted successfully' });
    } else {
      console.log('Customer not found.');
      res.json({ message: 'Customer not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred while deleting the document' });
  }
};



module.exports.showAvailableCredits_post = async (req, res) => {
    let soniSirMongoObjId = '649d5066643927b562115c98';
    try {
        const user = await User.findById(soniSirMongoObjId).select('AvailableCredits').exec();
        const users = await User.find({ createdBy: 'soniSir' }).select('AvailableCredits').exec();
        const totalCustomerCredits = users.reduce((total, user) => total + user.AvailableCredits, 0);
        if (!user) {
            throw new Error('User not found');
        }

        // Make the HTTP request to retrieve the balance sms value
        const url = 'http://sandesh.sonisms.in/getbalance.jsp?user=SCHOOL3&key=a90266792eXX&accusage=1';
        const response = await axios.get(url);

        // Parse the data from the response
        const smsCount = response.data;

        const availableCredits = user.AvailableCredits;


        // Make the HTTP request to retrieve the balance sms value
        const dlturl = 'http://sandesh.sonisms.in/getbalance.jsp?user=SCHOOL3&key=a90266792eXX&accusage=11';
        const dltRes = await axios.get(dlturl);

        // Parse the data from the response
        const dltsmsCount = dltRes.data;


        res.json({ availableCredits, totalCustomerCredits, smsCount, dltsmsCount });
    } catch (error) {
        res.status(400).json(error.message);
    }
};

module.exports.showAvailableCreditsToCustomer_post = async (req, res) => {
    const token = req.cookies.jwt;
    if (token) {
        jwt.verify(token, 'mayu secret', async (err, decodedToken) => {
            if (err) {
                res.json(err);
            } else {
                const user = await User.findById(decodedToken.id).select('AvailableCredits').exec();
                const whatsappCreditsCount = user.AvailableCredits;

                const doc = await User.findOne({ _id: decodedToken.id });
                const smsUserName = doc.smsUserName;
                const smsKey = doc.smsKey;
                // Make the HTTP request to retrieve the balance sms value
                const url = `http://sandesh.sonisms.in/getbalance.jsp?user=${smsUserName}&key=${smsKey}&accusage=1`;
                const response = await axios.get(url);
                
                // Parse the data from the response
                const smsCount = response.data;
                

                
                res.json({ whatsappCreditsCount, smsCount });
            }
        });
    }
    else {
        res.json('problem with cookies');
    }
};


