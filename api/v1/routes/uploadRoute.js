const express = require('express')
const router = express.Router()
const { upload, uploadImage } = require('../handlers/uploads')
const {verifyToken} = require('../../../middlewares/authentication')

router.post('/', verifyToken, upload.single('image'), uploadImage)

module.exports = router