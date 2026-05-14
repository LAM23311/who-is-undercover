const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

let rooms = {};
let apiConfig = {
  enabled: false,
  url: 'https://api.example.com/chat/completions',
  apiKey: '',
  model: 'gpt-3.5-turbo'
};

const defaultWords = [
  { civilian: '牛奶', undercover: '豆浆' },
  { civilian: '牙刷', undercover: '牙膏' },
  { civilian: '手机', undercover: '电话' },
  { civilian: '火车', undercover: '高铁' },
  { civilian: '篮球', undercover: '足球' },
  { civilian: '米饭', undercover: '面条' },
  { civilian: '苹果', undercover: '梨' },
  { civilian: '电脑', undercover: '电视' },
  { civilian: '书', undercover: '杂志' },
  { civilian: '鞋', undercover: '袜子' }
];

function getRandomWords() {
  const index = Math.floor(Math.random() * defaultWords.length);
  return defaultWords[index];
}

async function fetchWordsFromAI() {
  if (!apiConfig.enabled) {
    return getRandomWords();
  }
  
  try {
    const response = await axios.post(apiConfig.url, {
      model: apiConfig.model,
      messages: [{
        role: 'user',
        content: '请提供一对相似但不同的词语，用于"谁是卧底"游戏。格式为JSON：{"civilian":"平民词","undercover":"卧底词"}。要求两个词要有相似之处但不能完全相同，适合作为游戏词语。'
      }],
      max_tokens: 50
    }, {
      headers: {
        'Authorization': `Bearer ${apiConfig.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = response.data.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error('AI API调用失败，使用默认词库:', error.message);
    return getRandomWords();
  }
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  socket.on('createRoom', async (config) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const words = await fetchWordsFromAI();
    
    rooms[roomId] = {
      config: config,
      words: words,
      players: [],
      status: 'waiting',
      currentRound: 0,
      speakingPlayer: null,
      votes: {},
      gameStarted: false
    };
    
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, words });
  });

  socket.on('joinRoom', (data) => {
    const { roomId, playerName } = data;
    const room = rooms[roomId];
    
    if (!room) {
      socket.emit('error', '房间不存在');
      return;
    }
    
    if (room.status !== 'waiting') {
      socket.emit('error', '游戏已开始');
      return;
    }
    
    if (room.players.length >= room.config.totalPlayers) {
      socket.emit('error', '房间已满');
      return;
    }
    
    if (room.players.some(p => p.name === playerName)) {
      socket.emit('error', '昵称已存在');
      return;
    }
    
    room.players.push({
      id: socket.id,
      name: playerName,
      role: null,
      word: null,
      socket: socket
    });
    
    socket.join(roomId);
    
    io.to(roomId).emit('playerJoined', {
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    
    const { totalPlayers, undercoverCount, whiteboardCount } = room.config;
    const civilianCount = totalPlayers - undercoverCount - whiteboardCount;
    
    let roles = [];
    for (let i = 0; i < civilianCount; i++) roles.push('civilian');
    for (let i = 0; i < undercoverCount; i++) roles.push('undercover');
    for (let i = 0; i < whiteboardCount; i++) roles.push('whiteboard');
    
    roles = shuffleArray(roles);
    
    room.players.forEach((player, index) => {
      player.role = roles[index];
      player.word = player.role === 'civilian' ? room.words.civilian : 
                   player.role === 'undercover' ? room.words.undercover : null;
    });
    
    room.status = 'playing';
    room.gameStarted = true;
    room.currentRound = 1;
    room.speakingPlayer = 0;
    
    room.players.forEach(player => {
      player.socket.emit('gameStarted', {
        role: player.role,
        word: player.word,
        totalPlayers: room.config.totalPlayers
      });
    });
    
    io.to(roomId).emit('roundStart', {
      round: room.currentRound,
      speaker: room.players[0].id
    });
  });

  socket.on('speak', (data) => {
    const { roomId, content } = data;
    const room = rooms[roomId];
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    
    io.to(roomId).emit('playerSpoke', {
      playerId: player.id,
      playerName: player.name,
      content
    });
    
    room.speakingPlayer = (room.speakingPlayer + 1) % room.players.length;
    
    if (room.speakingPlayer === 0) {
      room.status = 'voting';
      room.votes = {};
      io.to(roomId).emit('votingStart');
    } else {
      io.to(roomId).emit('nextSpeaker', room.players[room.speakingPlayer].id);
    }
  });

  socket.on('vote', (data) => {
    const { roomId, targetPlayerId } = data;
    const room = rooms[roomId];
    if (!room) return;
    
    room.votes[socket.id] = targetPlayerId;
    
    if (Object.keys(room.votes).length === room.players.length) {
      const voteCounts = {};
      Object.values(room.votes).forEach(vote => {
        voteCounts[vote] = (voteCounts[vote] || 0) + 1;
      });
      
      let maxVotes = 0;
      let votedPlayerId = null;
      for (const [playerId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
          maxVotes = count;
          votedPlayerId = playerId;
        }
      }
      
      const votedPlayer = room.players.find(p => p.id === votedPlayerId);
      
      io.to(roomId).emit('voteResult', {
        playerId: votedPlayerId,
        playerName: votedPlayer.name,
        role: votedPlayer.role
      });
      
      room.players = room.players.filter(p => p.id !== votedPlayerId);
      
      const civilianRemaining = room.players.filter(p => p.role === 'civilian').length;
      const undercoverRemaining = room.players.filter(p => p.role === 'undercover').length;
      
      if (undercoverRemaining === 0) {
        room.status = 'ended';
        io.to(roomId).emit('gameEnd', { winner: 'civilian' });
        delete rooms[roomId];
      } else if (civilianRemaining <= undercoverRemaining) {
        room.status = 'ended';
        io.to(roomId).emit('gameEnd', { winner: 'undercover' });
        delete rooms[roomId];
      } else {
        room.currentRound++;
        room.status = 'playing';
        room.speakingPlayer = 0;
        
        io.to(roomId).emit('roundStart', {
          round: room.currentRound,
          speaker: room.players[0].id
        });
      }
    }
  });

  socket.on('getApiConfig', () => {
    socket.emit('apiConfig', apiConfig);
  });

  socket.on('setApiConfig', (config) => {
    apiConfig = { ...apiConfig, ...config };
    socket.emit('apiConfigUpdated', apiConfig);
  });

  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      
      if (room.players.length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

app.get('/api/rooms', (req, res) => {
  res.json(Object.keys(rooms).map(roomId => ({
    roomId,
    playerCount: rooms[roomId].players.length,
    maxPlayers: rooms[roomId].config.totalPlayers,
    status: rooms[roomId].status
  })));
});

app.post('/api/api-config', (req, res) => {
  apiConfig = { ...apiConfig, ...req.body };
  res.json(apiConfig);
});

app.get('/api/api-config', (req, res) => {
  res.json(apiConfig);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});