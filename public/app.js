const socket = io();

let currentRoomId = null;
let currentRole = null;
let currentWord = null;
let currentRound = 1;
let isHost = false;
let allPlayers = [];
let selectedVotePlayer = null;
let voteCountdown = 10;
let countdownTimer = null;

const screens = {
  mainMenu: document.getElementById('mainMenu'),
  createRoom: document.getElementById('createRoom'),
  joinRoom: document.getElementById('joinRoom'),
  settings: document.getElementById('settings'),
  waitingRoom: document.getElementById('waitingRoom'),
  gameScreen: document.getElementById('gameScreen'),
  votingScreen: document.getElementById('votingScreen'),
  voteResult: document.getElementById('voteResult'),
  gameOver: document.getElementById('gameOver')
};

function showScreen(screenName) {
  Object.keys(screens).forEach(name => {
    screens[name].classList.remove('active');
  });
  screens[screenName].classList.add('active');
}

function showToast(message) {
  const toast = document.getElementById('errorToast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function adjustNumber(fieldId, delta) {
  const input = document.getElementById(fieldId);
  const min = parseInt(input.min);
  const max = parseInt(input.max);
  let value = parseInt(input.value);
  value += delta;
  if (value >= min && value <= max) {
    input.value = value;
  }
}

// 主菜单事件
document.getElementById('createRoomBtn').addEventListener('click', () => {
  showScreen('createRoom');
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  showScreen('joinRoom');
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  showScreen('settings');
  loadSettings();
});

// 返回按钮
document.getElementById('backFromCreate').addEventListener('click', () => {
  showScreen('mainMenu');
});

document.getElementById('backFromJoin').addEventListener('click', () => {
  showScreen('mainMenu');
});

document.getElementById('backFromSettings').addEventListener('click', () => {
  showScreen('mainMenu');
});

// 创建房间
document.getElementById('createBtn').addEventListener('click', () => {
  const totalPlayers = parseInt(document.getElementById('totalPlayers').value);
  const undercoverCount = parseInt(document.getElementById('undercoverCount').value);
  const whiteboardCount = parseInt(document.getElementById('whiteboardCount').value);
  const creatorName = document.getElementById('creatorName').value;
  
  if (!creatorName.trim()) {
    showToast('请输入昵称');
    return;
  }
  
  if (undercoverCount + whiteboardCount >= totalPlayers) {
    showToast('平民人数不能为0');
    return;
  }
  
  socket.emit('createRoom', {
    totalPlayers,
    undercoverCount,
    whiteboardCount
  });
});

socket.on('roomCreated', (data) => {
  currentRoomId = data.roomId;
  
  socket.emit('joinRoom', {
    roomId: currentRoomId,
    playerName: document.getElementById('creatorName').value || '房主'
  });
});

// 加入房间
document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId = document.getElementById('roomIdInput').value;
  const playerName = document.getElementById('playerName').value;
  
  if (!roomId || roomId.length !== 4 || isNaN(roomId)) {
    showToast('请输入4位数字房间号');
    return;
  }
  
  if (!playerName.trim()) {
    showToast('请输入昵称');
    return;
  }
  
  currentRoomId = roomId;
  socket.emit('joinRoom', { roomId, playerName });
});

socket.on('playerJoined', (data) => {
  const playersList = document.getElementById('playersList');
  playersList.innerHTML = '';
  
  data.players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.name;
    if (player.isHost) {
      li.innerHTML += ' <span class="host-badge">房主</span>';
    }
    playersList.appendChild(li);
  });
  
  updateRoomInfo();
});

socket.on('error', (message) => {
  showToast(message);
});

function updateRoomInfo() {
  const totalPlayers = document.getElementById('totalPlayers').value;
  const undercoverCount = document.getElementById('undercoverCount').value;
  const whiteboardCount = document.getElementById('whiteboardCount').value;
  
  document.getElementById('totalPlayersDisplay').textContent = totalPlayers;
  document.getElementById('undercoverDisplay').textContent = undercoverCount;
  document.getElementById('whiteboardDisplay').textContent = whiteboardCount;
  
  document.getElementById('roomIdDisplay').textContent = currentRoomId;
  document.getElementById('roomIdValue').textContent = currentRoomId;
  
  showScreen('waitingRoom');
}

// 离开房间
document.getElementById('leaveRoomBtn').addEventListener('click', () => {
  currentRoomId = null;
  showScreen('mainMenu');
});

// 复制房间号
document.getElementById('copyRoomIdBtn').addEventListener('click', async () => {
  if (!currentRoomId) return;
  
  try {
    await navigator.clipboard.writeText(currentRoomId);
    showToast('房间号已复制到剪贴板');
  } catch (err) {
    const textArea = document.createElement('textarea');
    textArea.value = currentRoomId;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast('房间号已复制到剪贴板');
  }
});

// 分享给好友
document.getElementById('shareBtn').addEventListener('click', () => {
  if (!currentRoomId) return;
  
  const shareText = `来玩「谁是卧底」！房间号：${currentRoomId}\n打开浏览器访问服务器地址即可加入`;
  
  if (navigator.share) {
    navigator.share({
      title: '谁是卧底游戏',
      text: shareText,
    }).catch(() => {
      fallbackShare();
    });
  } else {
    fallbackShare();
  }
  
  function fallbackShare() {
    try {
      navigator.clipboard.writeText(shareText);
      showToast('分享内容已复制，快去发给好友吧！');
    } catch (err) {
      showToast(`房间号：${currentRoomId}\n请手动复制分享`);
    }
  }
});

// 开始游戏
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame', currentRoomId);
});

socket.on('gameStarted', (data) => {
  currentRole = data.role;
  currentWord = data.word;
  currentRound = 1;
  isHost = data.isHost;
  allPlayers = data.players;
  
  displayGameInfo();
  renderGamePlayers();
  
  if (isHost) {
    document.getElementById('hostControls').style.display = 'block';
    document.getElementById('startVoteBtn').style.display = 'block';
    document.getElementById('pkVoteBtn').style.display = 'none';
  } else {
    document.getElementById('hostControls').style.display = 'none';
  }
  
  document.getElementById('voteTimer').style.display = 'none';
  document.getElementById('pkStatus').style.display = 'none';
  document.getElementById('voteControls').style.display = 'none';
  
  showScreen('gameScreen');
});

function displayGameInfo() {
  const roleText = document.querySelector('#identityCard .card-header');
  const wordText = document.querySelector('#identityCard .card-word');
  
  if (currentRole === 'civilian') {
    roleText.textContent = '你的身份：平民';
    roleText.style.color = '#28a745';
  } else if (currentRole === 'undercover') {
    roleText.textContent = '你的身份：卧底';
    roleText.style.color = '#dc3545';
  } else {
    roleText.textContent = '你的身份：白板';
    roleText.style.color = '#6c757d';
  }
  
  wordText.textContent = currentWord || '???';
}

function renderGamePlayers() {
  const list = document.getElementById('gamePlayersList');
  list.innerHTML = '';
  
  allPlayers.forEach(player => {
    const li = document.createElement('li');
    li.dataset.playerId = player.id;
    li.textContent = player.name;
    
    if (player.eliminated) {
      li.classList.add('eliminated');
    }
    
    li.addEventListener('click', () => {
      if (player.eliminated) return;
      
      document.querySelectorAll('#gamePlayersList li').forEach(item => {
        item.classList.remove('selected');
      });
      
      li.classList.add('selected');
      selectedVotePlayer = player.id;
    });
    
    list.appendChild(li);
  });
}

// 房主开始投票
document.getElementById('startVoteBtn').addEventListener('click', () => {
  socket.emit('startVote', currentRoomId);
});

// PK投票
document.getElementById('pkVoteBtn').addEventListener('click', () => {
  socket.emit('endPKVote', currentRoomId);
});

// 提交投票
document.getElementById('submitVoteBtn').addEventListener('click', () => {
  if (!selectedVotePlayer) {
    showToast('请选择要投票的玩家');
    return;
  }
  
  socket.emit('vote', {
    roomId: currentRoomId,
    targetPlayerId: selectedVotePlayer
  });
  
  document.getElementById('submitVoteBtn').style.display = 'none';
});

socket.on('voteStarted', (data) => {
  voteCountdown = data.countdown;
  
  document.getElementById('voteTimer').style.display = 'block';
  document.getElementById('voteControls').style.display = 'block';
  document.getElementById('submitVoteBtn').style.display = 'block';
  document.getElementById('pkStatus').style.display = 'none';
  
  if (isHost) {
    document.getElementById('hostControls').style.display = 'none';
  }
  
  updateCountdown();
  
  countdownTimer = setInterval(() => {
    voteCountdown--;
    updateCountdown();
    
    if (voteCountdown <= 0) {
      clearInterval(countdownTimer);
      socket.emit('endVote', currentRoomId);
    }
  }, 1000);
});

function updateCountdown() {
  document.getElementById('timerCountdown').textContent = voteCountdown;
}

socket.on('voteUpdated', (data) => {
  // 可以在这里更新投票进度显示
});

socket.on('pkStarted', (data) => {
  clearInterval(countdownTimer);
  document.getElementById('voteTimer').style.display = 'none';
  
  document.getElementById('pkStatus').style.display = 'block';
  document.getElementById('pkPlayer1').textContent = data.pkPlayers[0]?.name || '';
  document.getElementById('pkPlayer2').textContent = data.pkPlayers[1]?.name || '';
  
  // 更新玩家列表，高亮PK玩家
  const list = document.getElementById('gamePlayersList');
  const items = list.querySelectorAll('li');
  
  items.forEach(item => {
    const playerId = item.dataset.playerId;
    const isPK = data.pkPlayers.some(p => p.id === playerId);
    
    if (isPK) {
      item.classList.add('pk-player');
      item.classList.remove('selected');
      item.style.pointerEvents = 'none';
    } else if (!item.classList.contains('eliminated')) {
      item.classList.remove('pk-player');
      item.style.pointerEvents = 'auto';
    }
  });
  
  selectedVotePlayer = null;
  
  if (isHost) {
    document.getElementById('hostControls').style.display = 'block';
    document.getElementById('startVoteBtn').style.display = 'none';
    document.getElementById('pkVoteBtn').style.display = 'block';
  } else {
    document.getElementById('voteControls').style.display = 'block';
    document.getElementById('submitVoteBtn').style.display = 'block';
  }
});

socket.on('playerEliminated', (data) => {
  clearInterval(countdownTimer);
  
  const player = allPlayers.find(p => p.id === data.playerId);
  if (player) {
    player.eliminated = true;
  }
  
  renderGamePlayers();
  
  showScreen('voteResult');
  
  const resultIcon = document.querySelector('#voteResult .result-icon');
  const resultTitle = document.querySelector('#voteResult .result-title');
  const resultContent = document.querySelector('#voteResult .result-content');
  const resultRole = document.querySelector('#voteResult .result-role');
  
  resultContent.textContent = `${data.playerName} 被淘汰`;
  
  if (data.role === 'undercover') {
    resultIcon.textContent = '🎉';
    resultTitle.textContent = '好样的！';
    resultRole.textContent = `身份：卧底`;
  } else if (data.role === 'civilian') {
    resultIcon.textContent = '😢';
    resultTitle.textContent = '可惜了';
    resultRole.textContent = `身份：平民`;
  } else {
    resultIcon.textContent = '🤔';
    resultTitle.textContent = '出局';
    resultRole.textContent = `身份：白板`;
  }
});

document.getElementById('continueBtn').addEventListener('click', () => {
  showScreen('gameScreen');
  
  if (isHost) {
    document.getElementById('hostControls').style.display = 'block';
    document.getElementById('startVoteBtn').style.display = 'block';
    document.getElementById('pkVoteBtn').style.display = 'none';
  }
  
  document.getElementById('voteTimer').style.display = 'none';
  document.getElementById('pkStatus').style.display = 'none';
  document.getElementById('voteControls').style.display = 'none';
});

socket.on('roundChanged', (data) => {
  currentRound = data.round;
  document.querySelector('.round-info').textContent = `第 ${currentRound} 轮`;
  
  // 更新玩家投票权限
  allPlayers.forEach(p => {
    if (!p.eliminated) {
      const item = document.querySelector(`#gamePlayersList li[data-player-id="${p.id}"]`);
      if (item) {
        item.style.pointerEvents = 'auto';
        item.classList.remove('pk-player');
      }
    }
  });
  
  selectedVotePlayer = null;
});

// 游戏结束
socket.on('gameEnd', (data) => {
  showScreen('gameOver');
  
  const resultIcon = document.querySelector('#gameOver .result-icon');
  const resultTitle = document.querySelector('#gameOver .result-title');
  const resultContent = document.querySelector('#gameOver .result-content');
  
  if (data.winner === 'civilian') {
    resultIcon.textContent = '🏆';
    resultTitle.textContent = '平民胜利！';
    resultContent.textContent = currentRole === 'civilian' ? '恭喜你获得胜利！' : '卧底被全部找出，平民胜利！';
  } else if (data.winner === 'undercover') {
    resultIcon.textContent = '🎭';
    resultTitle.textContent = '卧底胜利！';
    resultContent.textContent = currentRole === 'undercover' ? '恭喜你获得胜利！' : '平民被淘汰至与卧底人数相同，卧底胜利！';
  } else if (data.winner === 'whiteboard') {
    resultIcon.textContent = '🤍';
    resultTitle.textContent = '白板胜利！';
    resultContent.textContent = currentRole === 'whiteboard' ? `恭喜你连续${currentRound}轮未被淘汰，获得胜利！` : `${data.winnerName} 连续${currentRound}轮未被淘汰，白板胜利！`;
  }
  
  // 显示词语
  if (data.words) {
    document.querySelector('.words-reveal').style.display = 'block';
    document.querySelector('.words-reveal .word-highlight:first-child').textContent = data.words.civilian;
    document.querySelector('.words-reveal .word-highlight:last-child').textContent = data.words.undercover;
  }
});

document.getElementById('backToMenuBtn').addEventListener('click', () => {
  currentRoomId = null;
  currentRole = null;
  currentWord = null;
  currentRound = 1;
  isHost = false;
  allPlayers = [];
  selectedVotePlayer = null;
  showScreen('mainMenu');
});

// 设置页面
function loadSettings() {
  socket.emit('getSettings');
}

socket.on('settings', (settings) => {
  document.getElementById('useAI').checked = settings.useAI;
  document.getElementById('whiteboardWinRounds').value = settings.whiteboardWinRounds;
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  const config = {
    useAI: document.getElementById('useAI').checked,
    whiteboardWinRounds: parseInt(document.getElementById('whiteboardWinRounds').value)
  };
  
  socket.emit('setSettings', config);
  showToast('设置已保存');
});

socket.on('settingsUpdated', () => {
  showToast('设置已更新');
});
