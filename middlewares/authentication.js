const jwt = require("jsonwebtoken");
// const User = require('../api/v1/models/user');
const { Pay } = require("twilio/lib/twiml/VoiceResponse");
const CustomError = require('.././errors');

const User = require('../api/v1/models/user')

const verifyToken = (req, res, next) => {

     const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer')) {
      return res.status(401).json("authentication invalid!");
    }

    // if (!authHeader) {
    //   return res.status(401).json("authentication invalid!");
    // }

    const token = authHeader.split(" ")[1];
    try{
        const payload = jwt.verify(token, process.env.JWT_SECRET)
        req.user ={userId: payload.userId,name:payload.name,email:payload.email,role:payload.role,
          country:payload.country}
        next();
    }catch(e){
        return res.status(401).json("You are not authenticated!");
    }
 
};


const verifyTokenAndAuthorization = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.id === req.params.id || req.user.isAdmin) {
      next();
    } else {
      res.status(403).json("You are not alowed to do that!");
    }
  });
};



const authorizePermissions = (...roles) => {
    return (req, res, next) => {
        // console.log(req.user)
      if (!roles.includes(req.user.role)) {
        throw new CustomError.UnauthorizedError(
          'Unauthorized to access this route'
        );
      }
      next();
    };
  };
  

const adminAuth = async (req,res,next)=>{

    try{
  
      const userId = req.user.userId;
  
      const user = await User.findById(userId);
  
      if(!user || user.role !== "admin"){
        return res.status(403).json({
          success:false,
          message:"Admin access required"
        });
      }
  
      next();
  
    }catch(error){
  
      res.status(500).json({
        success:false,
        message:error.message
      });
  
    }
  
}
module.exports = {
  verifyToken,
  verifyTokenAndAuthorization,
  adminAuth,
  authorizePermissions

  // verifyTokenAndAdmin,
};