const socket = io();

let currentRoomId = null;
let currentRole = null;
let currentWord = null;
let currentRound = 1;

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
  document.getElementById('creatorName').value = '';
  
  socket.emit('joinRoom', {
    roomId: currentRoomId,
    playerName: document.getElementById('creatorName').value || '房主'
  });
});

// 加入房间
document.getElementById('joinBtn').addEventListener('click', () => {
  const roomId = document.getElementById('roomIdInput').value.toUpperCase();
  const playerName = document.getElementById('playerName').value;
  
  if (!roomId || roomId.length !== 6) {
    showToast('请输入6位房间号');
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
    // 降级方案
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
  displayGameInfo();
  showScreen('gameScreen');
});

function displayGameInfo() {
  const roleText = document.querySelector('.card-header');
  const wordText = document.querySelector('.card-word');
  
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

socket.on('roundStart', (data) => {
  currentRound = data.round;
  document.querySelector('.round-info').textContent = `第 ${currentRound} 轮`;
  updateSpeaker(data.speaker);
});

function updateSpeaker(speakerId) {
  const indicator = document.getElementById('speakerIndicator');
  
  const playersList = document.getElementById('playersList');
  const players = Array.from(playersList.querySelectorAll('li'));
  const speakerName = players.find((_, index) => index === 0)?.textContent || '未知玩家';
  
  indicator.textContent = `${speakerName} 正在发言...`;
  
  const speakBtn = document.getElementById('speakBtn');
  const speakInput = document.getElementById('speakInput');
  
  if (speakerId === socket.id) {
    speakBtn.disabled = false;
    speakInput.disabled = false;
    speakInput.focus();
  } else {
    speakBtn.disabled = true;
    speakInput.disabled = true;
  }
}

// 发言
document.getElementById('speakBtn').addEventListener('click', () => {
  const content = document.getElementById('speakInput').value.trim();
  
  if (!content) {
    showToast('请输入发言内容');
    return;
  }
  
  socket.emit('speak', {
    roomId: currentRoomId,
    content
  });
  
  document.getElementById('speakInput').value = '';
});

socket.on('playerSpoke', (data) => {
  const chatMessages = document.getElementById('chatMessages');
  const messageItem = document.createElement('div');
  messageItem.className = 'message-item';
  messageItem.innerHTML = `
    <div class="sender">${data.playerName}</div>
    <div class="content">${data.content}</div>
  `;
  chatMessages.appendChild(messageItem);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('nextSpeaker', (speakerId) => {
  updateSpeaker(speakerId);
});

// 投票阶段
socket.on('votingStart', () => {
  showScreen('votingScreen');
  renderVotingPlayers();
});

function renderVotingPlayers() {
  const playersList = document.getElementById('playersList');
  const players = Array.from(playersList.querySelectorAll('li')).map(li => ({
    id: '',
    name: li.textContent
  }));
  
  const votingPlayers = document.getElementById('votingPlayers');
  votingPlayers.innerHTML = '';
  
  players.forEach(player => {
    if (player.name) {
      const card = document.createElement('div');
      card.className = 'player-card';
      card.innerHTML = `<div class="name">${player.name}</div>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        
        socket.emit('vote', {
          roomId: currentRoomId,
          targetPlayerId: player.id
        });
      });
      votingPlayers.appendChild(card);
    }
  });
}

// 投票结果
socket.on('voteResult', (data) => {
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
  } else {
    resultIcon.textContent = '🎭';
    resultTitle.textContent = '卧底胜利！';
    resultContent.textContent = currentRole === 'undercover' ? '恭喜你获得胜利！' : '平民被淘汰至与卧底人数相同，卧底胜利！';
  }
  
  socket.emit('getRoomWords', currentRoomId);
});

document.getElementById('backToMenuBtn').addEventListener('click', () => {
  currentRoomId = null;
  currentRole = null;
  currentWord = null;
  currentRound = 1;
  showScreen('mainMenu');
});

// 设置页面
function loadSettings() {
  socket.emit('getApiConfig');
}

socket.on('apiConfig', (config) => {
  document.getElementById('useAI').checked = config.enabled;
  document.getElementById('apiUrl').value = config.url;
  document.getElementById('apiKey').value = config.apiKey;
  document.getElementById('modelName').value = config.model;
  
  document.getElementById('aiConfig').classList.toggle('hidden', !config.enabled);
});

document.getElementById('useAI').addEventListener('change', (e) => {
  document.getElementById('aiConfig').classList.toggle('hidden', !e.target.checked);
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  const config = {
    enabled: document.getElementById('useAI').checked,
    url: document.getElementById('apiUrl').value,
    apiKey: document.getElementById('apiKey').value,
    model: document.getElementById('modelName').value
  };
  
  socket.emit('setApiConfig', config);
  showToast('设置已保存');
});

socket.on('apiConfigUpdated', () => {
  showToast('设置已更新');
});