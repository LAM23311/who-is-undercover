const express = require('express');
const http = require('http');
const path = require('path');
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let rooms = {};
let gameSettings = {
  useAI: false,
  whiteboardWinRounds: 2,
  aiConfig: {
    apiKey: 'sk-618cfaffa9df40e48553aa6f31ca7c89',
    model: 'qwen-turbo',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  }
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
  { civilian: '鞋', undercover: '袜子' },
  { civilian: '猫', undercover: '狗' },
  { civilian: '桌子', undercover: '椅子' },
  { civilian: '水', undercover: '饮料' },
  { civilian: '太阳', undercover: '月亮' },
  { civilian: '老虎', undercover: '狮子' }
];

function getRandomWords() {
  const index = Math.floor(Math.random() * defaultWords.length);
  return defaultWords[index];
}

async function fetchWordsFromAI() {
  if (!gameSettings.useAI) {
    return getRandomWords();
  }
  
  try {
    const response = await axios.post(`${gameSettings.aiConfig.apiBase}/chat/completions`, {
      model: gameSettings.aiConfig.model,
      messages: [{
        role: 'user',
        content: '请提供一对相似但不同的词语，用于"谁是卧底"游戏。格式为JSON：{"civilian":"平民词","undercover":"卧底词"}。要求两个词要有相似之处但不能完全相同，适合作为游戏词语。只返回JSON，不要其他内容。'
      }],
      max_tokens: 50
    }, {
      headers: {
        'Authorization': `Bearer ${gameSettings.aiConfig.apiKey}`,
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
    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    
    const words = await fetchWordsFromAI();
    
    rooms[roomId] = {
      config: config,
      words: words,
      players: [],
      status: 'waiting',
      currentRound: 0,
      votes: {},
      gameStarted: false,
      hostId: null,
      isVoting: false,
      isPK: false,
      pkPlayers: [],
      whiteboardWinRounds: gameSettings.whiteboardWinRounds,
      whiteboardSurvivedRounds: {}
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
    
    const isHost = room.players.length === 0;
    
    room.players.push({
      id: socket.id,
      name: playerName,
      role: null,
      word: null,
      socket: socket,
      isHost: isHost,
      eliminated: false,
      canVote: true
    });
    
    if (isHost) {
      room.hostId = socket.id;
    }
    
    socket.join(roomId);
    
    io.to(roomId).emit('playerJoined', {
      players: room.players.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, eliminated: p.eliminated }))
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
      player.eliminated = false;
      player.canVote = true;
    });
    
    room.status = 'playing';
    room.gameStarted = true;
    room.currentRound = 1;
    room.votes = {};
    room.isVoting = false;
    room.isPK = false;
    room.pkPlayers = [];
    room.whiteboardSurvivedRounds = {};
    
    room.players.forEach(player => {
      player.socket.emit('gameStarted', {
        role: player.role,
        word: player.word,
        totalPlayers: room.config.totalPlayers,
        isHost: player.isHost,
        players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, eliminated: p.eliminated }))
      });
    });
  });

  socket.on('startVote', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    
    if (room.status !== 'playing') return;
    
    room.isVoting = true;
    room.isPK = false;
    room.votes = {};
    room.pkPlayers = [];
    
    io.to(roomId).emit('voteStarted', { countdown: 10 });
  });

  socket.on('vote', (data) => {
    const { roomId, targetPlayerId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.isVoting) return;
    
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.eliminated || !voter.canVote) return;
    
    room.votes[socket.id] = targetPlayerId;
    
    io.to(roomId).emit('voteUpdated', {
      votes: room.votes,
      totalVoters: room.players.filter(p => !p.eliminated && p.canVote).length
    });
  });

  socket.on('endVote', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    
    const validPlayers = room.players.filter(p => !p.eliminated);
    const civilianRemaining = validPlayers.filter(p => p.role === 'civilian').length;
    const undercoverRemaining = validPlayers.filter(p => p.role === 'undercover').length;
    const whiteboardRemaining = validPlayers.filter(p => p.role === 'whiteboard').length;
    
    // 检查白板获胜条件
    let whiteboardWinner = null;
    for (const player of validPlayers) {
      if (player.role === 'whiteboard') {
        room.whiteboardSurvivedRounds[player.id] = (room.whiteboardSurvivedRounds[player.id] || 0) + 1;
        if (room.whiteboardSurvivedRounds[player.id] >= room.whiteboardWinRounds) {
          whiteboardWinner = player;
          break;
        }
      }
    }
    
    if (whiteboardWinner) {
      room.status = 'ended';
      io.to(roomId).emit('gameEnd', { 
        winner: 'whiteboard', 
        winnerName: whiteboardWinner.name,
        words: room.words 
      });
      return;
    }
    
    // 统计票数
    const voteCounts = {};
    Object.values(room.votes).forEach(vote => {
      voteCounts[vote] = (voteCounts[vote] || 0) + 1;
    });
    
    // 找出最高票数
    let maxVotes = 0;
    const topPlayers = [];
    
    for (const [playerId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        topPlayers.length = 0;
        topPlayers.push(playerId);
      } else if (count === maxVotes) {
        topPlayers.push(playerId);
      }
    }
    
    if (topPlayers.length === 1) {
      // 只有一个最高票，直接淘汰
      const eliminatedPlayer = room.players.find(p => p.id === topPlayers[0]);
      eliminatedPlayer.eliminated = true;
      
      io.to(roomId).emit('playerEliminated', {
        playerId: eliminatedPlayer.id,
        playerName: eliminatedPlayer.name,
        role: eliminatedPlayer.role
      });
      
      checkGameEnd(roomId);
    } else if (topPlayers.length > 1) {
      // 平票，进入PK
      room.isPK = true;
      room.pkPlayers = topPlayers;
      
      // 重置投票，只有非PK玩家可以投票
      room.votes = {};
      
      room.players.forEach(p => {
        p.canVote = !p.eliminated && !topPlayers.includes(p.id);
      });
      
      io.to(roomId).emit('pkStarted', {
        pkPlayers: topPlayers.map(id => {
          const p = room.players.find(player => player.id === id);
          return { id: p.id, name: p.name };
        })
      });
    } else {
      // 没有投票，继续游戏
      room.currentRound++;
      io.to(roomId).emit('roundChanged', { round: room.currentRound });
    }
    
    room.isVoting = false;
  });

  socket.on('pkVote', (data) => {
    const { roomId, targetPlayerId } = data;
    const room = rooms[roomId];
    if (!room) return;
    if (!room.isPK) return;
    
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.eliminated || !voter.canVote) return;
    
    room.votes[socket.id] = targetPlayerId;
    
    io.to(roomId).emit('voteUpdated', {
      votes: room.votes,
      totalVoters: room.players.filter(p => !p.eliminated && p.canVote).length
    });
  });

  socket.on('endPKVote', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    
    const voteCounts = {};
    Object.values(room.votes).forEach(vote => {
      voteCounts[vote] = (voteCounts[vote] || 0) + 1;
    });
    
    let maxVotes = 0;
    let eliminatedPlayerId = null;
    
    for (const [playerId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedPlayerId = playerId;
      }
    }
    
    if (eliminatedPlayerId) {
      const eliminatedPlayer = room.players.find(p => p.id === eliminatedPlayerId);
      eliminatedPlayer.eliminated = true;
      
      io.to(roomId).emit('playerEliminated', {
        playerId: eliminatedPlayer.id,
        playerName: eliminatedPlayer.name,
        role: eliminatedPlayer.role
      });
      
      checkGameEnd(roomId);
    } else {
      // PK投票也没人投，随机淘汰一个
      const randomIndex = Math.floor(Math.random() * room.pkPlayers.length);
      const eliminatedPlayer = room.players.find(p => p.id === room.pkPlayers[randomIndex]);
      eliminatedPlayer.eliminated = true;
      
      io.to(roomId).emit('playerEliminated', {
        playerId: eliminatedPlayer.id,
        playerName: eliminatedPlayer.name,
        role: eliminatedPlayer.role
      });
      
      checkGameEnd(roomId);
    }
    
    room.isPK = false;
    room.pkPlayers = [];
    room.isVoting = false;
  });

  function checkGameEnd(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    
    const validPlayers = room.players.filter(p => !p.eliminated);
    const civilianRemaining = validPlayers.filter(p => p.role === 'civilian').length;
    const undercoverRemaining = validPlayers.filter(p => p.role === 'undercover').length;
    
    if (undercoverRemaining === 0) {
      room.status = 'ended';
      io.to(roomId).emit('gameEnd', { winner: 'civilian', words: room.words });
      delete rooms[roomId];
    } else if (civilianRemaining <= undercoverRemaining) {
      room.status = 'ended';
      io.to(roomId).emit('gameEnd', { winner: 'undercover', words: room.words });
      delete rooms[roomId];
    } else {
      // 进入下一轮
      room.currentRound++;
      room.votes = {};
      
      // 重置所有玩家的投票权限
      room.players.forEach(p => {
        p.canVote = !p.eliminated;
      });
      
      io.to(roomId).emit('roundChanged', { round: room.currentRound });
    }
  }

  socket.on('getSettings', () => {
    socket.emit('settings', gameSettings);
  });

  socket.on('setSettings', (settings) => {
    gameSettings = { ...gameSettings, ...settings };
    io.emit('settingsUpdated', gameSettings);
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

app.post('/api/settings', (req, res) => {
  gameSettings = { ...gameSettings, ...req.body };
  res.json(gameSettings);
});

app.get('/api/settings', (req, res) => {
  res.json(gameSettings);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
