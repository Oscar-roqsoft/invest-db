// app/v1/responses/index.js
const { StatusCodes } = require('http-status-codes');

const sendSuccessResponseData = (res, message, data = {}, statusCode = StatusCodes.CREATED) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data: { ...data },
  });
};

const sendSuccessResponse = (res, message, statusCode = StatusCodes.CREATED) => {
  return res.status(statusCode).json({
    success: true,
    message,
  });
};

const sendBadRequestResponse = (res, message) => {
  return res.status(StatusCodes.BAD_REQUEST).json({
    success: false,
    message,
  });
};

const sendConflictResponse = (res, message) => {
  return res.status(StatusCodes.CONFLICT).json({
    success: false,
    message,
  });
};

const sendInternalServerErrorResponse = (res, message) => {
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message,
  });
};

const sendUnauthenticatedErrorResponse = (res, message) => {
  return res.status(StatusCodes.UNAUTHORIZED).json({
    success: false,
    message,
  });
};

const sendForbiddenResponse = (res, message) => {
  return res.status(StatusCodes.FORBIDDEN).json({
    success: false,
    message,
  });
};

const sendNotFoundResponse = (res, message) => {
  return res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    message,
  });
};

module.exports = {
  sendBadRequestResponse,
  sendInternalServerErrorResponse,
  sendSuccessResponse,
  sendSuccessResponseData,
  sendUnauthenticatedErrorResponse,
  sendConflictResponse,
  sendForbiddenResponse,
  sendNotFoundResponse,
};