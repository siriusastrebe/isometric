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
var roomDescriptions = {}

var defaultDescription = {
  cobblestone: {
    url: 'cobblestone.png'
  }
}


io.on('connection', function (socket) {
  var referer = socket.handshake.headers.referer
  var room = url.parse(referer).pathname.substring(1)

  // Default to lobby
  if (room === '') { room = 'lobby' }

  socket.join(room)

  // ----------------------------------------------------------------
  // Joining a new room
  // ----------------------------------------------------------------
  if (roomTiles[room] === undefined && roomDescriptions[room] === undefined) {
    fs.exists('rooms/' + room, function (exists) {
      if (exists) {
        fs.readFile('rooms/' + room + '/tiles.txt', 'utf8', function (err, data) {
          if (!err) {
            roomTiles[room] = JSON.parse(data)
          } else if (err.code === 'ENOENT') {
            roomTiles[room] = {}
          }
          socket.emit('roomTiles', roomTiles[room])
        })

        fs.readFile('rooms/' + room + '/description.txt', 'utf8', function (err, data) {
          if (!err) {
            roomDescriptions[room] = JSON.parse(data)
          } else if (err.code === 'ENOENT') {
            roomDescriptions[room] = defaultDescription
          }
          socket.emit('roomDescription', roomDescriptions[room])
        })
      } else {
        fs.mkdir('rooms/' + room, function () {
          roomTiles[room] = {}
          socket.emit('roomTiles', roomTiles[room])
        })
      }
    })
  } else {
    socket.emit('roomTiles', roomTiles[room])
    socket.emit('roomDescription', roomDescriptions[room])
  }


  // ----------------------------------------------------------------
  // Editing a room
  // ----------------------------------------------------------------
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

//  socket.on('addTileDefinition')
//  socket.on('removeTileDefinition')

  socket.on('newTile', function (fileName, buffer) {
    if (roomDescriptions[room]) {
      var fullPath = 'rooms/' + room + '/' + fileName;
      var name = fileName.split('.')[0]

      // Files that start with 89504e47 are .png, 47494638 are .gif
      var fileHex = new Buffer(buffer.toString('binary'), 'ascii').toString('hex')
      var identifier = fileHex.substring(0, 8)
      console.log('identifier', identifier)
      if (identifier !== '89504e47' && identifier !== '47494638') {
        socket.emit('badFileType')
        return
      }

      fs.open(fullPath, 'a', 0755, function(err, fd) {
        if (err) throw err;

        fs.write(fd, buffer, null, 'Binary', function (err, written, buff) {
          fs.close(fd, function () {
            roomDescriptions[room][name] = {url: fullPath}
            var json = JSON.stringify(roomDescriptions[room], null, 2)

            fs.writeFile('rooms/' + room + '/description.txt', json, function (a) {
              console.log('Writing description of ', room, a)
            })

            io.to(room).emit('newTile', {name: name, url: fullPath})
          })
        })
      })
    }
  })

  socket.emit('welcome', { message: 'Welcome!', id: socket.id });
})

// ----------------------------------------------------------------
// Chron jobs
// ----------------------------------------------------------------
// Saving rooms
setInterval(function () {
  for (var room in roomNeedsWrite) {
    var json = JSON.stringify(roomTiles[room], null, 2)
    fs.writeFile('rooms/' + room + '/tiles.txt', json, function(a) {
      console.log('Writing tiles of ', room, a)
    })
    delete roomNeedsWrite[room]
  }
}, 6000)
