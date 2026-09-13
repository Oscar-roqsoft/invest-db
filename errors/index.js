const { CustomApiError } = require('../errors/custom-errors')
const BadRequestError = require('../errors/bad-request')
const UnauthenticatedError = require('../errors/unauthenticated')
const UnauthorizedError = require('../errors/unauthorised');

module.exports = {
  CustomApiError,
  BadRequestError,
  UnauthenticatedError,
  UnauthorizedError
}