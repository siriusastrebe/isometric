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
    var extension = path.extname(filename).split(".")[1]

    // Serve the single page application on any route
    if (extension === 'html' || extension === undefined) {
      filename = 'index.html'
    }

    // Serve resources
    fs.exists(filename, function (exists) {
        if (exists) {
            var mimeType = mimeTypes[extension]
            res.writeHead(200, mimeType)

            var fileStream = fs.createReadStream(filename)
            fileStream.pipe(res)
        } else {
            // 404 not found
            console.log("File " + filename + " does not exist.")
            res.writeHead(200, {'Content-Type': 'text/plain'})
            res.write('404 Not Found\n')
            res.end()
        }
    })
}).listen(1337)

var participants = {}

var io = socketio(server)

var roomTiles = {}
var roomNeedsWrite = {}

io.on('connection', function (socket) {
  var referer = socket.handshake.headers.referer
  var room = url.parse(referer).pathname.substring(1)

  socket.join(room)
  if (roomTiles[room] === undefined) {
		fs.readFile('rooms/' + room + '.txt', 'utf8', function (err, data) {
      if (!err) {
        roomTiles[room] = JSON.parse(data)
        socket.emit('roomState', roomTiles[room])
      } else if (err.code === 'ENOENT') {
        roomTiles[room] = {}
        socket.emit('roomState', roomTiles[room])
      }
    })
  } else {
    socket.emit('roomState', roomTiles[room])
  }

  socket.on('addTile', function (data) {
    if (roomTiles[room]) {
      socket.to(room).emit('addTile', data)
      roomTiles[room][data.id] = data.type
      roomNeedsWrite[room] = true
    }
  })

  socket.on('removeTile', function (data) {
    if (roomTiles[room]) {
      socket.to(room).emit('removeTile', data)
      delete roomTiles[room][data]
      roomNeedsWrite[room] = true
    }
  })

//  socket.on('removeTile')
//  socket.on('addTileDefinition')
//  socket.on('removeTileDefinition')

//  function getFullState () {
//  }

//  function saveState () {
//  }

  socket.emit('welcome', { message: 'Welcome!', id: socket.id });

/*
  socket.on('i am client', function (id) { console.log(id); socket.broadcast.to(room).emit('whoot', 'whoot ' + id ); io.to(room).emit('whoot', 'hahahahaha') });

  setTimeout(function () { 
    socket.disconnect()
  }, 5000)
*/
})

// Saving rooms
setInterval(function () {
  for (var room in roomNeedsWrite) {
    var json = JSON.stringify(roomTiles[room], null, 2)
    fs.writeFile('rooms/' + room + '.txt', json, function(a) {
      console.log('Writing changes to ', room, a)
    })
    delete roomNeedsWrite[room]
  }
}, 6000)
