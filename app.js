const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser')
const { requireAuth, checkUser } = require('./middleware/authMiddleware');
const dotenv = require("dotenv");
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const User = require('./models/User');
const fileUpload = require("express-fileupload");
const fs = require('fs');
const path = require('path');
const axios = require('axios');


dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080

// middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload())// https://sebhastian.com/express-fileupload/
// https://www.npmjs.com/package/express-fileupload

app.set('views', path.join(__dirname, 'views'));
// view engine
app.set('view engine', 'ejs');



// TO STORE WHATSAPP SESSIONS LOCALLY TO SPEED MESSAGE SENDING. DO NOT REMOVE THIS LINE.
const sessionMap = new Map();

let newlyGeneratedQRCode = '';

mongoose.connect(process.env.MONGODBURI).then(e => {
  console.log('Mongodb is connected');
})


app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
})




app.get('/', (req, res) => { res.render('login') });
app.get('*', checkUser);
// app.get('/', (req, res) => {res.render('sonisirpage')}); // temporarily
app.get('/customerpage', requireAuth, (req, res) => res.render('customerpage'));
app.get('/sonisirpage', requireAuth, (req, res) => res.render('sonisirpage'));
app.use(authRoutes)


//cookies
app.get('/set-cookies', (req, res) => {
  res.cookie('newuser', false, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true });
  res.send('you got the cookies')
})

app.get('/generateqrcode', (req, res) => {

  let token = generateRandomString();
  console.log('client is being started ', token);
  try {
    
    const client = new Client({
      restartOnAuthFail: true,
      puppeteer: {
         executablePath: '/usr/bin/google-chrome-stable',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          // '--single-process', // <- this one doesn't works in Windows
          '--disable-gpu'
        ],
      },
      authStrategy: new LocalAuth({
        clientId: token,
      }),
    });

    client.on('qr', async (qr) => {
      console.log('qr called');
      const generateqrcode = await QRCode.toDataURL(qr);
      // res.status(200).json({ qrCode: generateqrcode, tokenKey: token });
      newlyGeneratedQRCode = generateqrcode;
    })

    client.on('ready', async () => {
      console.log('qrside ready event fired');
      console.log(`whatsapp is ready, id is ${token}`);
      newlyGeneratedQRCode = 'stopGeneratingQRCode';
      let connectedWhatsappNo = client.info.wid.user
      console.log('server wh no is ' + connectedWhatsappNo);
      sessionMap.set(token, {
        id: token,
        client: client,
        serverWhatsappNo: connectedWhatsappNo
      });
      const loggedinCustomerObj = res.locals.user;
      insertClientSessionDetailsToCustomerDocument(loggedinCustomerObj, token, connectedWhatsappNo)
      setupMessageListenersForAllClients();
    })

  
    client.on('authenticated', () => {
      console.log('client is authenticated');
    })
    client.on('disconnected', (reason) => {
      console.log('Client was logged out', reason);
      client.destroy();
    });
  client.initialize();
  } catch (err) {
    res.status(400).json({ error: 'something went wrong, Please contact system administrator' });
  }
})






// https://www.youtube.com/watch?v=piEYV-fsYbA
 app.get('/qrcodewithsse', (req, res) => {
  console.log('Browser has started to listening server side events...');
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Access-Control-Allow-Origin', '*')
  const intervalId = setInterval(() => {
    res.write(`data: ${newlyGeneratedQRCode}\n\n`)
    // res.write(newlyGeneratedQRCode)
  }, 2500)
  res.on('close', () => {
    console.log('Browser has stopped to listening server side events...')
    clearInterval(intervalId)
    res.end()
  })
  if (newlyGeneratedQRCode == 'stopGeneratingQRCode') {
    clearInterval(intervalId)
    res.end()
  }
}); 




// GENERATING RANDOM STRING TO SAVE CLIENT SESSIONS
function generateRandomString() {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;

  for (let i = 0; i < 20; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}


function insertClientSessionDetailsToCustomerDocument(custObj, token, connectedWaNo) {
  let loggedinCustomerid = custObj._id.toString();
  let stringedToken = token.toString();
  let stringedconnectedWaNo = connectedWaNo.toString();
  // Find a user by their ID
  User.findById(loggedinCustomerid)
    .then(user => {
      if (!user) {
        // Handle case where user is not found
        console.log('Customer Document Not Found In MongoDB');
        return;
      }
      // Push the new object into the connectedWhatsAppDevices array
      let deviceObj = { token: stringedToken, connectedWano: stringedconnectedWaNo }
      user.connectedWhatsAppDevices.push(deviceObj);
      // https://www.mongodb.com/docs/manual/tutorial/query-arrays/#query-an-array
      // Save the updated user
      return user.save();
    })
    .then(updatedUser => {
      if (updatedUser) {
        console.log('Object pushed into connectedWhatsAppDevices array:', updatedUser);
      }
    })
    .catch(error => {
      console.error(error);
    });
}





app.post('/api/sendmessage', async (req, res) => {
  let customerId = req.body.customerid;
  let whatsappClientId = req.body.serverWhatsappno;
  let mobileNo = req.body.mobileno;
  let mobNoAsUID =  formattedwaNo(mobileNo);
  let message = req.body.message;
  let messageType = req.body.type;
  console.log(whatsappClientId);
  try {
    User.findById(customerId)
      .then(async (user) => {
        if (!user) {
          // Handle case where user is not found
          res.status(404).json({
            status: false,
            response: "Customer Not Found"
          });
        } else {
          if (user.AvailableCredits > 1) {
            for (const device of user.connectedWhatsAppDevices) {
              if (device.connectedWano === whatsappClientId) {
                token = device.token;
                console.log(token);
                const session = sessionMap.get(token);
                if (session) {
                  if (messageType === 'text') { // SEND ONLY TEXT MESSAGES
                    const client = session.client;
                  await client.sendMessage(mobNoAsUID, message).then(async (response) => {
                    user.AvailableCredits--;
                    await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                    res.status(200).json({
                      status: true,
                      // response: response
                      response: {
                        status: 'Message Sent Successfully',
                        availableCredits: user.AvailableCredits
                      }
                    });
                  }).catch(err => {
                    console.log(err);
                    res.status(500).json({
                      status: false,
                      response: err
                    });
                  });
                  }  else if (messageType === 'file') {
                    let mimeType = req.files.file.mimetype;
                    let file = req.files.file;
                    let fileName = req.files.file.name;
                    console.log(fileName);
                  
                    // Check if the file format is supported
                    const supportedFormats = ['jpeg', 'jpg', 'png', 'gif', 'pdf', 'xls', 'xlsx', 'mp4', 'mkv', 'avi', 'mov', '3gp'];
                    const fileFormat = fileName.split('.').pop().toLowerCase();
                    if (!supportedFormats.includes(fileFormat)) {
                      return res.status(400).json({ error: 'Unsupported file format' });
                    }
                  
                    const filePath = await manageUploadedFile('create', file);
                    console.log('filepath is ' + filePath);
                    const media = MessageMedia.fromFilePath(filePath);
                    console.log('media is ' + media);
                    const client = session.client;
                    await client.sendMessage(mobNoAsUID, media, { caption: message }).then(async (response) => {
                      user.AvailableCredits--;
                      await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                      res.status(200).json({
                        status: true,
                        response: {
                          status: 'Message Sent Successfully',
                          availableCredits: user.AvailableCredits
                        }
                      });
                      manageUploadedFile('delete', file);
                  
                    }).catch(err => {
                      manageUploadedFile('delete', file);
                      console.log(err);
                      res.status(500).json({
                        status: false,
                        response: err
                      });
                    });
                  }
                } else {
                  console.log('your token is ' + token);
                  
                  const client = new Client({
                    restartOnAuthFail: true,
                    puppeteer: {
                       executablePath: '/usr/bin/google-chrome-stable',
                      headless: true,
                      args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        // '--single-process', // <- this one doesn't works in Windows
                        '--disable-gpu'
                      ],
                    },
                    authStrategy: new LocalAuth({
                      clientId: token,
                    }),
                  });
                  client.on('qr', () => {
                    console.log('asking qr code');
                    res.status(500).json({
                      response: 'Asking for qr code'
                    })
                  });
                  client.on('ready', async () => {
                    console.log('sendmessage side ready event fired');
                    let connectedWhatsappNo = client.info.wid.user;
                    sessionMap.set(token, {
                      id: token,
                      client: client,
                      serverWhatsappNo: connectedWhatsappNo
                    });
                    if (messageType === 'text') { // SEND ONLY TEXT MESSAGES
                      // const client = session.client;
                    await client.sendMessage(mobNoAsUID, message).then(async (response) => {
                      user.AvailableCredits--;
                      await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                      res.status(200).json({
                        status: true,
                        // response: response
                        response: {
                          status: 'Message Sent Successfully',
                          availableCredits: user.AvailableCredits
                        }
                      });
                    }).catch(err => {
                      console.log(err);
                      res.status(500).json({
                        status: false,
                        response: err
                      });
                    });
                    } else if (messageType === 'file') {
                      let mimeType = req.files.file.mimetype;
                      let file = req.files.file;
                      let fileName = req.files.file.name;
                    
                      // Check if the file format is supported
                      const supportedFormats = ['jpeg', 'jpg', 'png', 'gif', 'pdf', 'xls', 'xlsx', 'mp4', 'mkv', 'avi', 'mov', '3gp'];
                      const fileFormat = fileName.split('.').pop().toLowerCase();
                      if (!supportedFormats.includes(fileFormat)) {
                        return res.status(400).json({ error: 'Unsupported file format' });
                      }
                    
                      const filePath = await manageUploadedFile('create', file);
                      const media = MessageMedia.fromFilePath(filePath);
                      const client = session.client;
                      await client.sendMessage(mobNoAsUID, media, { caption: message }).then(async (response) => {
                        user.AvailableCredits--;
                        await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                        res.status(200).json({
                          status: true,
                          response: {
                            status: 'Message Sent Successfully',
                            availableCredits: user.AvailableCredits
                          }
                        });
                        manageUploadedFile('delete', file);
                    
                      }).catch(err => {
                        manageUploadedFile('delete', file);
                        console.log(err);
                        res.status(500).json({
                          status: false,
                          response: err
                        });
                      });
                    }
                    setupMessageListenersForAllClients();
                  })
                  client.initialize();
                }
                break;
              }
            }
          }
          else {
            res.status(500).json({
              status: false,
              response: 'Insufficient Credits: Please Add Credit.'
            })
          }
        }
      })
      .catch(error => {
        let errorMessage = error.message;
        if (errorMessage.includes('Cast to ObjectId')) {
          res.status(500).json({
            status: false,
            response: "Customer Not Found."
          });
        }
      });
  } catch (error) {
    console.log(error);
  }
}); 


// WINDOWS COMPATIBLE

function manageUploadedFile(action, file) {
  return new Promise((resolve, reject) => {
    try {
      if (action === 'create') {
        const filePath = path.join(__dirname, 'tmp', file.name);
      
        file.mv(filePath, (err) => {
          if (err) {
            console.error(err);
            reject(err); // Reject the promise on failure
          } else {
            resolve(filePath); // Resolve the promise with the file path on success
          }
        });
      } else if (action === 'delete') {
        const filePath = path.join(__dirname, 'tmp', file.name);
      
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error(err);
            reject(err); // Reject the promise on failure
          } else {
            resolve(true); // Resolve the promise with true on success
          }
        });
      } else {
        const errorMessage = 'Invalid action';
        console.error(errorMessage);
        reject(new Error(errorMessage)); // Reject the promise with an error for invalid action
      }
    } catch (error) {
      reject(error); // Reject the promise on any other unexpected error
    }
  });
}


/* 
function manageUploadedFile(action, file) {
  return new Promise((resolve, reject) => {
    try {
      if (action === 'create') {
        const tmpDir = '/tmp';
        console.log(tmpDir);
        console.log(file.name);
        const filePath = path.join(tmpDir, file.name);
        
        fs.createReadStream(file.path).pipe(fs.createWriteStream(filePath))
          .on('finish', () => resolve(filePath))
          .on('error', reject);
        
      } else if (action === 'delete') {
        const tmpDir = '/tmp';
        const filePath = path.join(tmpDir, file.name);
        
        fs.unlink(filePath, (err) => {
          if (err) reject(err);
          else resolve(true);
        });
        
      } else {
        const errorMessage = 'Invalid action';
        reject(new Error(errorMessage));
      }
    } catch (error) {
      reject(error);
      console.log(error);
    }
  });
}
 */






// NOT REQUIRED FUNCTION

/* 

async function downloadFileFromUrl(fileUrl, action) {
  try {
    if (action === 'create') {
      const response = await axios.get(fileUrl, { responseType: 'stream' });
      const fileName = path.basename(fileUrl);
      const filePath = path.join(__dirname, 'tmp', fileName);

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      return filePath;
    } else if (action === 'delete') {
      const fileName = path.basename(fileUrl);
      const filePath = path.join(__dirname, 'tmp', fileName);

      await new Promise((resolve, reject) => {
        fs.unlink(filePath, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      return `File '${fileName}' has been deleted.`;
    } else {
      throw new Error(`Invalid action: ${action}. Use 'create' or 'delete'.`);
    }
  } catch (error) {
    console.error('Error while processing the action:', error);
    throw error;
  }
}
 */

function formattedwaNo(mobileNo) {
  try {
    if (mobileNo === undefined) {
      return
    } else {
      let stringed = mobileNo.toString();
  if (stringed.length === 10) {
    let mobNoAsUID = `91${stringed}@c.us`;
    return mobNoAsUID
  }
    }
  } catch (error) {
  console.log(error); 
  }
}

app.post('/deleteWhClientSession', async (req, res) => {
  let clientSessionObj  = req.body;
  let clientSessionId = clientSessionObj.clientSessionID;
  try {
    sessionMap.delete(clientSessionId); // delete session from local storage
    await User.updateOne(
      { connectedWhatsAppDevices: { $elemMatch: { token: clientSessionId } } },
      { $pull: { connectedWhatsAppDevices: { token: clientSessionId } } }
    );
    const client = new Client({
      restartOnAuthFail: true,
      puppeteer: {
         executablePath: '/usr/bin/google-chrome-stable',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          // '--single-process', // <- this one doesn't works in Windows
          '--disable-gpu'
        ],
      },
      authStrategy: new LocalAuth({
        clientId: clientSessionId,
      })
    });
    client.initialize();
    await client.logout(); // Logout from WhatsApp service
    client.pupBrowser.close(); // NEWLY ADDED, DELETE IF ERROR OCCURS
    console.log('Object removed successfully');
  } catch (error) {
    console.error(error);
  }
});


/* 
app.post('/api/sendbulk', async (req, res) => {
  const mobiles = req.body.tonums;
  const message = req.body.text;
  const via = req.body.via || 'whatsapp';
  const file = req.files && req.files.file ? req.files.file : null;
  const fileName = req.files && req.files.file.name ? req.files.file.name : null;
  const payloadCount = convertStringToArray(mobiles).length;
  // sms variables
  const tempid = req.body.tempid;
  const senderid = req.body.senderid; // when fal msg is given
  const idno = req.body.idno;
  const unicode = req.body.unicode; //language
  const time = req.body.time;
  const accusage = req.body.accusage;
  const fileURL = req.body.fileurl;
  const fallBackMessage = req.body.smsmsg; // fallback

  // whatsapp variables
  const customerid = req.body.custid;
  const senderWhatsappNo = req.body.fromnum;

  if (via === 'sms') {
    if (message.length > 0) {
      const response = await sendBulksms(customerid, mobiles, message, tempid, senderid, idno, unicode, time, accusage)
      res.status(200).send({
        response: response
      })
    } else {
      res.status(200).json({
        message: 'Can\'t send a blank message',
      });
    }
  } else if (via === 'whatsapp'){
    try {
      User.findById(customerid)
      .then( async (user) => {
        if (!user) {
          // Handle case where user is not found
          res.status(404).json({
            status: false,
            response: "Customer Not Found"
          });
        } else {
          if (user.AvailableCredits >= payloadCount) {
            for (const device of user.connectedWhatsAppDevices) {
              if (device.connectedWano === senderWhatsappNo) {
                const token = device.token;
                console.log(token);
                const response = await sendBulkWhatsapp(token, mobiles, message, fallBackMessage, file, fileURL,  fileName, idno, user, customerid, tempid, senderid, entityid, unicode, time, accusage, device.connectedWano);
              res.status(200).send(
                response
              );
              }
            }
          } else {
            res.status(200).json({
              message: "Inssufficient credits, Please top up your credits"
            });
          }
        }
      });
    } catch (error) {
      res.status(404).json(
        {message: error.message}
        )}
  }
});
 */


/* 

              async function sendBulkWhatsapp(token, mobiles, message, fallBackMessage, file, fileURL, fileName, idno, user, customerid, tempid, senderid, entityid, unicode, time, accusage, senderWa) {
                return new Promise(async (resolve, reject) => {
                  let whatsappMsgSentCount = '';
                  let results = [];
                  let filePath = ''
                  let filePathForURL = ''
                    
                  if (file) {
                    filePath = await manageUploadedFile('create', file);
                  }

                  if (fileURL) {
                    filePathForURL = await downloadFileFromUrl(fileURL, 'create');
                  }
                   
                  
                  const mobArr = convertStringToArray(mobiles);
                  const client = await getWhatsappSession(token);
                  if (client === 'clientIsNotConnected') {
                    resolve(`wh,failed,'Wh is not connected',0,${idno}`);
                  } else {
                  try {
                    for (const number of mobArr) {
                      const mobNoAsUID = `${number}@c.us`;
                      console.log(mobNoAsUID);
                      const isCurrNoIsRegisteredWithWhatsapp = await client.isRegisteredUser(number);
                      if (isCurrNoIsRegisteredWithWhatsapp) {
                        try {
                          if (!file && !fileURL) { // TEXT WHATSAPP ONLY
                            const result = await client.sendMessage(mobNoAsUID, message);
                            results.push(`wh,sent,success,${generateRandom5DigitNumber()},${idno},${number}`);
                          console.log(`Message sent to ${number}`);
                          whatsappMsgSentCount++;
                          } else if (file && !fileURL){ // FILE WITH CAPTION
                            // FILE SEND

                            // Check if the file format is supported
                              const supportedFormats = ['jpeg', 'jpg', 'png', 'gif', 'pdf', 'xls', 'xlsx', 'csv',];
                              const fileFormat = fileName.split('.').pop().toLowerCase();
                              if (!supportedFormats.includes(fileFormat)) {
                                return res.status(400).json({ error: 'Unsupported file format' });
                              }

                              
                              const media = MessageMedia.fromFilePath(filePath);
                              await client.sendMessage(mobNoAsUID, media, { caption: message }).then(async (response) => {
                                whatsappMsgSentCount++;
                              // results.push({ message: `Message sent to ${number}`, idno: idno, Via: 'Whatsapp' });
                              results.push(`wh,sent,success,${generateRandom5DigitNumber()},${idno},${number}`);
                              console.log(`Message sent to ${number}`);
                              // manageUploadedFile('delete', file);
                              })
                              
                          } else if (fileURL) { // send file with file url
                            
                            const media = MessageMedia.fromFilePath(filePathForURL);
                            await client.sendMessage(mobNoAsUID, media, { caption: message }).then(async (response) => {
                              whatsappMsgSentCount++;
                              results.push(`wh,sent,success,${generateRandom5DigitNumber()},${idno},${number}`);
                            console.log(`Message sent to ${number}`);
                            })
                          }
                        } catch (error) {
                          console.error(`Error sending message to ${number}:`, error);
                          results.push(`wh,not sent,failed,${generateRandom5DigitNumber()},${idno},${number}`);
                          console.log(error.message);
                        }
                      } else {
                        // send fallback text message
                        const smsPortalURL = 'http://sandesh.sonisms.in/submitsms.jsp?user=Chowgule&key=0e465e1124XX&mobile=';
                        const uriEncodedMessage = encodeURIComponent(fallBackMessage);
                        const smsConstructedURL = `${smsPortalURL}${number}&message=${uriEncodedMessage}&senderid=${senderid}&accusage=${accusage}&entityid=${entityid}&tempid=${tempid}&unicode=${unicode}&time=${time}&idno=${idno}`;
                        try {
                          const response = await axios.get(smsConstructedURL);
                          console.log(response.data); // Handle the response data here
                          results.push(`sms, ${response.data}`);
                        } catch (error) {
                          console.error(error);
                          // results.push({error: error.message});
                          results.push(`sms, ${error.message}`);
                        }
                      }
                      // no need to add time delay as IIB sends messages on the same whatsapp number.
                      // Add a random time delay between 2000 to 4000 milliseconds
                      // const delay = Math.floor(Math.random() * (1500 - 1000 + 1)) + 1000;
                      // await sleep(delay);
                    }
                    let updatedWhatsappCount = user.AvailableCredits - whatsappMsgSentCount;
                    await User.updateOne({ _id: customerid }, { $set: { AvailableCredits: updatedWhatsappCount } });

                    
                    resolve(results.join('\n')); // Join the array elements with '\n' to create a multi-line string

                    // delete locally stored file
                    if (file) {
                      manageUploadedFile('delete', file);
                    }
                    if (fileURL) {
                      downloadFileFromUrl(fileURL, 'delete');
                    }
                  } catch (error) {
                    console.log(error);
                    reject(`wh,failed,'Wh is not connected',0,${idno}`);
                  }
                }
                });
              } */
              
/* 

async function sendBulksms(customerid, mobiles, message, tempid, senderid, idno, unicode, time, accusage) {
  const result = [];
  try {
    User.findById(customerid)
    .then(async (user) => {
      if (!user) {
        // Handle case where user is not found
        res.status(404).json({
          status: false,
          response: "Customer Not Found"
        });
      } else {
        const userName = user.smsUserName;
        const smskey = user.smsKey;
        const entityid = user.entityId;
        const smsPortalURL = `http://sandesh.sonisms.in/submitsms.jsp?user=${userName}&key=${smskey}&mobile=`;
        const mobileArr = convertStringToArray(mobiles);
        const uriEncodedMessage = encodeURIComponent(message);
        for (let i = 0; i < mobileArr.length; i++) {
          const currMob = mobileArr[i];
          const smsConstructedURL = `${smsPortalURL}${currMob}&message=${uriEncodedMessage}&senderid=${senderid}&accusage=${accusage}&entityid=${entityid}&tempid=${tempid}&unicode=${unicode}&time=${time}&idno=${idno}`;
          try {
            const response = await axios.get(smsConstructedURL);
            console.log(response.data); // Handle the response data here
            result.push({response: response.data});
          } catch (error) {
            console.error(error);
            result.push({error: error.message});
          }
        }
       
      }
    })
  } catch (error) {
    result.push({error: error.message});
  }
  return result;
}
 */

function generateRandom5DigitNumber() {
  // Generate a random number between 10000 and 99999 (both inclusive)
  const randomNumber = Math.floor(Math.random() * 90000) + 10000;
  return randomNumber;
}

/* 

async function getWhatsappSession(token) {
  const session = sessionMap.get(token);
  if (session) {
    const client = session.client;
    const state = await client.getState();
    console.log(state);
    if (state === 'CONNECTED') {
      return client;
    } else { 
    return 'clientIsNotConnected'
  }
  } else {
    return new Promise((resolve, reject) => {
      const client = new Client({
        qrMaxRetries: 1, // to stop qr code to run infinitely.
         executablePath: '/usr/bin/google-chrome-stable',
        restartOnAuthFail: true,
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ],
        },
        authStrategy: new LocalAuth({
          clientId: token,
        })
      });
      client.on('qr', () => {
        console.log('asking qr code');
        resolve('clientIsNotConnected'); // if client is not connected, this sends response to the client that whatsapp is not connected
      });

      client.on('ready', () => {
        let connectedWhatsappNo = client.info.wid.user;
        sessionMap.set(token, {
          id: token,
          client: client,
          serverWhatsappNo: connectedWhatsappNo
        });
        resolve(client);
        setupMessageListenersForAllClients();
      });

      client.on('auth_failure', () => {
          console.log('auth_failure');
        resolve('wh is not connected');
      });
      client.initialize(); // Initialize the client
    });
  }
}
 */




// Converts string of poorly separated mobile numbers into an array
function convertStringToArray(str) {
  // Replace any occurrences of /, \, ; or space with a comma
  const modifiedStr = str.replace(/[\/\\;\s]/g, ",")

  // Split the modified string into an array using comma as the delimiter
  const arr = modifiedStr.split(",")

  // Remove any empty values from the array
  let newArr = arr.filter(value => value !== "")

  // Iterate through the array and check if each string starts with +91
  for (let i = 0; i < newArr.length; i++) {
    if (!newArr[i].startsWith("91")) {
      newArr[i] = "91" + newArr[i]
    }
  }
  return newArr
}



function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



//=====================================================================================================================


// Function to set up event listeners for incoming messages for a specific client




async function setupMessageListener(client) {
  client.on('message', async (message) => {
    try {
      const { body, from, fromMe, id, to } = message;
      const serverWaNo = to.replace(/@c\.us$/, '');
      // console.log('this is server wano ' + serverWaNo);
      const object = {
        msgBody: body,
        msgFrom: from.replace(/@c\.us$/, ''),
        msgFromMe: fromMe,
        msgId: id.id,
        msgSerialized: id._serialized,
        msgServerWaNo: serverWaNo,
      };

      const connectedClientNo = serverWaNo.replace(/@c\.us$/, '');
      const user = await User.findOne({ 'connectedWhatsAppDevices.connectedWano': connectedClientNo });
      if (user) {
        // console.log(user);
        const webhookURL = user.webHookUrl;
          console.log(webhookURL);
        if (webhookURL === 'nowebhook') {
          return null;
        } else {
          await axios.post(webhookURL, JSON.stringify(object));
        }
      } else {
        return null;
      }
    } catch (error) {
      // console.error('Error fetching webhookURL:', error);
      return null;
    }
  });
}





// Function to set up event listeners for all clients in the sessionMap
function setupMessageListenersForAllClients() {
  for (const session of sessionMap.values()) {
    console.log(session);
    setupMessageListener(session.client);
  }
}

// Call this function to set up event listeners for all clients
setupMessageListenersForAllClients();



//===================================================================================================================== 





// RESTORE SESSIONS AFTER SERVER RESTART TO AVOID DELAY

/* app.post('/restoresessions', async (req, res) => {

  try {
    // The code to restore sessions from the previous answer goes here
    // Fetch all users from the MongoDB collection
    const users = await User.find({});

    // Iterate through each user document
    for (const user of users) {
      // Access the connectedWhatsAppDevices array for each user
      for (const connectedWhatsAppDevice of user.connectedWhatsAppDevices) {
        const { token, connectedWano } = connectedWhatsAppDevice;
        const client = new Client({
          restartOnAuthFail: true,
          puppeteer: {
             executablePath: '/usr/bin/google-chrome-stable',
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              // '--single-process', // <- this one doesn't work on Windows
              '--disable-gpu'
            ],
          },
          authStrategy: new LocalAuth({
            clientId: token,
          })
        });
        //console.log(client.pupBrowser);
        await new Promise((resolve) => {
          client.on('ready', () => {
            resolve();
          });
          client.initialize();
        });

        sessionMap.set(token, {
          id: token,
          client: client,
          serverWhatsappNo: connectedWhatsappNo
        });
        setupMessageListenersForAllClients();
      }
    }

    console.log('Session map updated successfully.');
    res.status(200).json({ message: 'Session restoration successful.' });
  } catch (error) {
    console.error('Error updating session map:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
}); */



// RESTORE SESSIONS AFTER SERVER RESTART TO AVOID DELAY

/* app.post('/restoresessions', async (req, res) => {

  try {
    // The code to restore sessions from the previous answer goes here
    // Fetch all users from the MongoDB collection
    const users = await User.find({});

    // Iterate through each user document
    for (const user of users) {
      // Access the connectedWhatsAppDevices array for each user
      for (const connectedWhatsAppDevice of user.connectedWhatsAppDevices) {
        const { token, connectedWano } = connectedWhatsAppDevice;
        const client = new Client({
          restartOnAuthFail: true,
          puppeteer: {
            ////// executablePath: '/usr/bin/google-chrome-stable',
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              // '--single-process', // <- this one doesn't work on Windows
              '--disable-gpu'
            ],
          },
          authStrategy: new LocalAuth({
            clientId: token,
          })
        });
        //console.log(client.pupBrowser);
        await new Promise((resolve) => {
          client.on('ready', () => {
            resolve();
          });
          client.initialize();
        });

        sessionMap.set(token, {
          id: token,
          client: client,
          serverWhatsappNo: connectedWhatsappNo
        });
        setupMessageListenersForAllClients();
      }
    }

    console.log('Session map updated successfully.');
    res.status(200).json({ message: 'Session restoration successful.' });
  } catch (error) {
    console.error('Error updating session map:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
}); */
