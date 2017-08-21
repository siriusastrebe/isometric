var http = require('http'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    socketio = require('socket.io'),
    sha1 = require('./sha1')

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
console.log('Listening on port 1337')

var participants = {}

var io = socketio(server)

var roomTiles = {}
var roomNeedsWrite = {}
var roomDescriptions = {}

var characters = {}

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
          roomDescriptions[room] = defaultDescription
          socket.emit('roomTiles', roomTiles[room])
          socket.emit('roomDescription', roomDescriptions[room])
        })
      }

    })
  } else {
    if (roomTiles[room] === undefined) {
      roomTiles[room] = {}
    }
    if (roomDescriptions[room] === undefined) {
      roomDescriptions[room] = defaultDescription
    }

    socket.emit('roomTiles', roomTiles[room])
    socket.emit('roomDescription', roomDescriptions[room])
  }


  // ----------------------------------------------------------------
  // User Avatars
  // ----------------------------------------------------------------
  if (!characters[room]) {
    characters[room] = [] 
  }

  var avatar = {avatar: 'amazon', i: 0, j: 16, z: 1, id: randomShortId()}

  socket.broadcast.to(room).emit('newCharacters', [avatar])
  if (characters[room].length > 0) {
    socket.emit('newCharacters', characters[room])
  }

  characters[room].push(avatar)
  socket.emit('yourCharacter', avatar)

  socket.on('moveTo', function (data) {
    var destination = data[data.length - 1]
    avatar.i = destination[0]
    avatar.j = destination[1]
    avatar.z = destination[2]

    // TODO: Verify valid path
    socket.broadcast.to(room).emit('moveTo', {path: data, id: avatar.id})
  })

  // ----------------------------------------------------------------
  // Editing a room
  // ----------------------------------------------------------------
  socket.on('addTile', function (data) {
    if (roomTiles[room] && roomDescriptions[room][data.type]) {
      socket.to(room).emit('addTile', data)
      roomTiles[room][data.id] = data.type
      roomNeedsWrite[room] = true
    }
  })

  socket.on('subtractTile', function (data) {
    if (roomTiles[room]) {
      socket.to(room).emit('subtractTile', data)
      delete roomTiles[room][data]
      roomNeedsWrite[room] = true
    }
  })

  socket.on('editTile', function (data) {
    var tile = data.tile
    if (roomDescriptions[room] && roomDescriptions[room][tile]) {
      var changes = data.changes
      for (var change in changes) {
        roomDescriptions[room][tile][change] = changes[change]
      }

      var json = JSON.stringify(roomDescriptions[room], null, 2)
    
      fs.writeFile('rooms/' + room + '/description.txt', json, function (a) {
        console.log('Tile description edited. Writing description of ', room, a)
      })

      io.to(room).emit('editTile', data)
    }
  })

  socket.on('uploadTile', function (fileName, buffer) {
    if (roomDescriptions[room]) {
      var extension = fileName.split('.')[fileName.split('.').length - 1]
      var sanitizedName = fileName.split('.').slice(0, -1).join('').replace(/\W/g, '')
      var fileSize = buffer.length

      if (fileSize > 1000000) {
        socket.emit('alert', 'Uploaded file is too large. Try a .png or .gif under 1MB')
        return
      }

      // Files that start with 89504e47 are .png, 47494638 are .gif
      // http://www.astro.keele.ac.uk/oldusers/rno/Computing/File_magic.html#Image
      // http://stackoverflow.com/questions/30183082/convert-binary-to-hex-in-node-js
      var fileHex = new Buffer(buffer.toString('binary'), 'ascii').toString('hex')
      var identifier = fileHex.substring(0, 8)
      if (identifier !== '89504e47' && identifier !== '47494638') {
        console.log('Invalid file type', extension, identifier)
        socket.emit('alert', 'Improper file type. Try a .gif or .png file.')
        return
      }

      var hash = sha1.hash(fileHex)
      var fullPath = 'tiles/' + hash + '.' + extension

      fs.exists(fullPath, function (exists) {
        if (!exists) {
          fs.open(fullPath, 'a', 0755, function(err, fd) {
            if (err) throw err;

            fs.write(fd, buffer, null, 'Binary', function (err, written, buff) {
              console.log('File ', fullPath + ' written')

              fs.close(fd, function () {
                roomDescriptions[room][hash] = {url: fullPath}
                io.to(room).emit('newTile', {hash: hash, url: fullPath})

                var json = JSON.stringify(roomDescriptions[room], null, 2)

                fs.writeFile('rooms/' + room + '/description.txt', json, function (a) {
                  console.log('Added file. Writing description of ', room, a)
                })
              })
            })
          })
        } else {
          roomDescriptions[room][hash] = {url: fullPath}
          io.to(room).emit('newTile', {hash: hash, url: fullPath})
        }
      })
    }
  })

  socket.on('duplicateTile', function (id) {
    var original = roomDescriptions[room][id]
    if (original) {
      var url = original.url

      var hash = sha1.hash(String(Math.random() + Math.random()))

      roomDescriptions[room][hash] = {url: url}

      io.to(room).emit('newTile', {hash: hash, url: url})
 
      var json = JSON.stringify(roomDescriptions[room], null, 2)
      fs.writeFile('rooms/' + room + '/description.txt', json, function (a) {
        console.log('Duplicated tile. Writing description of ', room, a)
      })
    }
  })

  socket.on('deleteTile', function (id) {
    if (roomDescriptions[room][id]) {
      delete roomDescriptions[room][id]

      io.to(room).emit('deleteTile', id)

      var json = JSON.stringify(roomDescriptions[room], null, 2)
      fs.writeFile('rooms/' + room + '/description.txt', json, function (a) {
        console.log('Deleted tile from room. Writing description of ', room, a)
      })
    }
  })

  socket.on('disconnect', function () {
    console.log('Client disconnected from room ' + room);;
    io.to(room).emit('removeCharacter', avatar.id)

    if (characters[room]) {
      for (var i=0; i<characters[room].length; i++) {
        if (characters[room][i].id === avatar.id) {
          characters[room].splice(i, 1)
          break
        }
      }
    }
  });
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

// ----------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------
// Taken from https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
function randomShortId() {
  return 's' + Math.random().toString(36).substring(2);
}



