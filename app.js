var http = require('http'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    socketio = require('socket.io')

var mimeTypes = {
    "html": "text/html",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "js": "text/javascript",
    "css": "text/css"
}

var server = http.createServer(function (req, res) {
    var uri = url.parse(req.url).pathname
    var filename = path.join(process.cwd(), uri)
    fs.exists(filename, function (exists) {
        if (exists) {
            var mimeType = mimeTypes[path.extname(filename).split(".")[1]]
            res.writeHead(200, mimeType)

            var fileStream = fs.createReadStream(filename)
            fileStream.pipe(res)
        } else {
            console.log("File " + filename + " does not exist.")
            res.writeHead(200, {'Content-Type': 'text/plain'})
            res.write('404 Not Found\n')
            res.end()
        }
    })
}).listen(1337)

var io = socketio(server)

io.on('connection', function (socket) {
  console.log(socket.handshake.headers.referer)
  socket.emit('welcome', { message: 'Welcome!', id: socket.id });

  socket.on('i am client', console.log);
})
