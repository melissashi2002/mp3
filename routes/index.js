/*
 * Connect all of your endpoints together here.
 */
var h = require('./helpers');

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api', require('./users.js')(router));
    app.use('/api', require('./tasks.js')(router));

    // Unknown routes
    app.use(function (req, res) {
        h.send(res, 404, 'Endpoint not found', {});
    });

    // Errors thrown by any route end up here.
    app.use(function (err, req, res, next) {
        if (err instanceof h.ApiError) {
            return h.send(res, err.status, err.message, {});
        }
        if (err.type === 'entity.parse.failed') {
            return h.send(res, 400, 'The request body is not valid JSON', {});
        }
        console.error(err);
        h.send(res, 500, 'Something went wrong on the server. Please try again later.', {});
    });
};
