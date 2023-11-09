const jwt = require('jsonwebtoken');
const User = require('../models/User');

const requireAuth = (req, res, next) => {
    const token = req.cookies.jwt;

    // check json web token exists & is verified
    if (token) {
        jwt.verify(token, 'mayu secret', (err, decodedToken) => {
            if (err) {
                res.redirect('login');
            } else {
                next();
            }
        });
    }
    else {
        res.redirect('login');
    }
};

const checkUser = (req, res, next) => {
    const token = req.cookies.jwt;

    if (token) {
        jwt.verify(token, 'mayu secret', async (err, decodedToken) => {
            if (err) {
                res.locals.user = null;
                next();
            } else {
                // console.log(decodedToken);
                let user = await User.findById(decodedToken.id);
                let userListForSoniSir = await User.find( { "createdBy": "soniSir" } );
                res.locals.user = user;
                res.locals.userListForSoniSirPage = userListForSoniSir;
                next();
            }
        });
    }
    else {
        res.locals.user = null;
        next();
    }
};




module.exports = { requireAuth, checkUser };