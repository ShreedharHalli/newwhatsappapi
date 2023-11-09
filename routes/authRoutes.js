const Router = require('express')
const authController = require('../controllers/authController');

const router = Router();


router.post('/register', authController.register_post);
router.get('/login', authController.login_get);
router.get('/customerpage', authController.customerPage_get);
router.get('/logout', authController.logout_get);
router.get('/sonisirpage', authController.soniSirPage_get);
router.post('/login', authController.login_post);
router.post('/issuecreditsendpoint', authController.issuecreditsendpoint_post);
router.post('/deletecustomer', authController.deletecustomer_post);
router.post('/showAvailableCredits', authController.showAvailableCredits_post);
router.post('/showAvailableCreditsCustomer', authController.showAvailableCreditsToCustomer_post);


module.exports = router;