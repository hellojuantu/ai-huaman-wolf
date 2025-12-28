import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Game } from './Game.js';
import { LLMPlayer } from '../ai/LLMPlayer.js';

// 角色类导入（用于状态恢复）
import { Wolf } from './roles/Wolf.js';
import { Seer } from './roles/Seer.js';
import { Witch } from './roles/Witch.js';
import { Hunter } from './roles/Hunter.js';
import { Guard } from './roles/Guard.js';
import { Idiot } from './roles/Idiot.js';
import { Villager } from './roles/Villager.js';

const ROLE_CLASSES = {
  wolf: Wolf,
  seer: Seer,
  witch: Witch,
  hunter: Hunter,
  guard: Guard,
  idiot: Idiot,
  villager: Villager
};

const ROLE_NAME_MAP = {
  wolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  idiot: '白痴',
  villager: '平民'
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '../../data');

// 确保数据目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export class GameManager {
  constructor(config) {
    this.config = config;
    this.rooms = new Map(); // roomId -> Game
    this.players = new Map(); // odityUserId -> { ws, roomId, name }
    this.wsToUser = new Map(); // ws -> odityUserId
    this.loadData();
    this.startTimers();
  }

  // 启动定时任务
  startTimers() {
    // 自动保存（每30秒）
    this.autoSaveTimer = setInterval(() => {
      this.saveData();
    }, 30000);

    // 房间清理（每分钟）
    this.cleanupTimer = setInterval(() => {
      this.cleanupRooms();
    }, 60000);
  }

  // 停止定时任务（用于优雅关闭）
  stopTimers() {
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  // 房间清理
  cleanupRooms() {
    const now = Date.now();
    const roomsToDelete = [];

    this.rooms.forEach((game, roomId) => {
      // 空房间（无玩家）立即删除
      if (game.getPlayerCount() === 0) {
        roomsToDelete.push(roomId);
        return;
      }

      // 检查是否所有玩家都离线
      const hasOnlinePlayer = Array.from(game.players.values()).some((p) => !p.isAI && p.isOnline);

      // 已结束游戏30分钟后清理
      if (game.state === 'ended') {
        const endedTime = game.lastActivityTime || now;
        if (now - endedTime > 30 * 60 * 1000) {
          roomsToDelete.push(roomId);
          return;
        }
      }

      // 所有玩家离线超过10分钟删除
      if (!hasOnlinePlayer && game.lastActivityTime) {
        if (now - game.lastActivityTime > 10 * 60 * 1000) {
          roomsToDelete.push(roomId);
          return;
        }
      }

      // 等待状态房间1小时无活动清理
      if (game.state === 'waiting' && game.lastActivityTime) {
        if (now - game.lastActivityTime > 60 * 60 * 1000) {
          roomsToDelete.push(roomId);
          return;
        }
      }
    });

    // 执行删除
    roomsToDelete.forEach((roomId) => {
      this.rooms.delete(roomId);
      console.log(`房间 ${roomId} 已自动清理`);
    });

    if (roomsToDelete.length > 0) {
      this.saveData();
    }
  }

  // 加载持久化数据（恢复完整游戏状态）
  loadData() {
    try {
      const roomsPath = path.join(dataDir, 'rooms.json');
      if (fs.existsSync(roomsPath)) {
        let roomsData = JSON.parse(fs.readFileSync(roomsPath, 'utf-8'));

        // 确保数据是数组
        if (!Array.isArray(roomsData)) {
          console.warn('rooms.json 数据格式错误（非数组），重置为空');
          roomsData = [];
        }

        // 恢复每个房间
        for (const roomData of roomsData) {
          const game = new Game(roomData.roomId, roomData.hostId, this.config, this);

          // 恢复玩家
          for (const playerData of roomData.players) {
            let llmPlayer = null;
            if (playerData.isAI) {
              llmPlayer = new LLMPlayer(playerData.id, playerData.name, this.config.llm);
            }

            game.addPlayer(playerData.id, playerData.name, playerData.isAI, llmPlayer);

            // 恢复全局玩家映射
            if (!playerData.isAI) {
              this.players.set(playerData.id, {
                ws: null,
                name: playerData.name,
                roomId: roomData.roomId
              });
            }

            // 恢复玩家状态
            const player = game.players.get(playerData.id);
            if (player) {
              player.isAlive = playerData.isAlive !== false;
              player.isOnline = playerData.isAI ? true : false; // 人类玩家初始离线
              player.canVote = playerData.canVote !== false;

              // 恢复角色（如果游戏已开始）
              if (playerData.role && roomData.state === 'playing') {
                const roleKey = Object.keys(ROLE_NAME_MAP).find((k) => ROLE_NAME_MAP[k] === playerData.role);
                if (roleKey && ROLE_CLASSES[roleKey]) {
                  player.role = new ROLE_CLASSES[roleKey](player.id, game);
                  if (playerData.roleState) {
                    player.role.restoreState(playerData.roleState);
                  }
                }
              }
            }
          }

          // 恢复游戏状态
          game.restoreState(roomData);

          this.rooms.set(roomData.roomId, game);
        }

        console.log(`数据加载完成，恢复了 ${roomsData.length} 个房间`);
      } else {
        console.log('无保存数据，从空状态开始');
      }
    } catch (err) {
      console.error('加载数据失败:', err);
    }
  }

  // 保存数据（完整游戏状态）
  saveData() {
    try {
      const roomsData = [];
      this.rooms.forEach((game, roomId) => {
        roomsData.push(game.toJSON());
      });
      fs.writeFileSync(path.join(dataDir, 'rooms.json'), JSON.stringify(roomsData, null, 2));
    } catch (err) {
      console.error('保存数据失败:', err);
    }
  }

  // 处理 WebSocket 消息
  handleMessage(ws, message) {
    const { type, data } = message;

    switch (type) {
      case 'join':
        this.handleJoin(ws, data);
        break;
      case 'create_room':
        this.handleCreateRoom(ws, data);
        break;
      case 'join_room':
        this.handleJoinRoom(ws, data);
        break;
      case 'leave_room':
        this.handleLeaveRoom(ws);
        break;
      case 'add_ai':
        this.handleAddAI(ws, data);
        break;
      case 'remove_ai':
        this.handleRemoveAI(ws, data);
        break;
      case 'start_game':
        this.handleStartGame(ws);
        break;
      case 'game_action':
        this.handleGameAction(ws, data);
        break;
      case 'chat':
        this.handleChat(ws, data);
        break;
      case 'get_rooms':
        this.handleGetRooms(ws);
        break;
      case 'pause_game':
        this.handlePauseGame(ws);
        break;
      case 'resume_game':
        this.handleResumeGame(ws);
        break;
      case 'exit_game':
        this.handleExitGame(ws);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: '未知消息类型' }));
    }
  }

  // 获取房间列表
  handleGetRooms(ws) {
    const roomList = [];
    this.rooms.forEach((game, roomId) => {
      if (game.state === 'waiting') {
        roomList.push({
          roomId,
          playerCount: game.getPlayerCount(),
          hostName: game.players.get(game.hostId)?.name || '未知'
        });
      }
    });

    ws.send(
      JSON.stringify({
        type: 'room_list',
        data: { rooms: roomList }
      })
    );
  }

  // 玩家加入（注册身份）
  handleJoin(ws, data) {
    const { userId, name } = data;
    if (!userId || !name) {
      ws.send(JSON.stringify({ type: 'error', message: '缺少用户信息' }));
      return;
    }

    // 检查是否已存在（重连）
    const existing = this.players.get(userId);
    if (existing) {
      existing.ws = ws;
      this.wsToUser.set(ws, userId);

      // 如果在房间中，检查房间状态
      if (existing.roomId) {
        const game = this.rooms.get(existing.roomId);

        // 如果房间不存在或已结束，清除 roomId
        if (!game || game.state === 'ended') {
          existing.roomId = null;
        } else {
          // 标记玩家为在线并发送房间状态
          game.markPlayerOnline(userId);
          this.broadcastRoomState(game);

          // 如果游戏正在进行，尝试恢复游戏循环
          if (game.state === 'playing' && !game.isLoopRunning) {
            game.isLoopRunning = true;
            game.resumeGameLoop().finally(() => {
              game.isLoopRunning = false;
            });
          }
        }
      }

      ws.send(
        JSON.stringify({
          type: 'joined',
          data: { userId, name, roomId: existing.roomId }
        })
      );
    } else {
      this.players.set(userId, { ws, name, roomId: null });
      this.wsToUser.set(ws, userId);

      ws.send(
        JSON.stringify({
          type: 'joined',
          data: { userId, name, roomId: null }
        })
      );
    }
  }

  // 创建房间
  handleCreateRoom(ws, data) {
    const userId = this.wsToUser.get(ws);
    if (!userId) {
      ws.send(JSON.stringify({ type: 'error', message: '请先加入游戏' }));
      return;
    }

    const player = this.players.get(userId);

    // 检查是否已在房间中（排除已结束的房间）
    if (player.roomId) {
      const existingGame = this.rooms.get(player.roomId);
      if (existingGame && existingGame.state !== 'ended') {
        ws.send(JSON.stringify({ type: 'error', message: '您已在房间中' }));
        return;
      } else {
        // 清除已结束或不存在的房间
        player.roomId = null;
      }
    }

    const roomId = this.generateRoomId();
    const game = new Game(roomId, userId, this.config, this);
    game.addPlayer(userId, player.name, false);

    this.rooms.set(roomId, game);
    player.roomId = roomId;

    this.sendRoomState(ws, game);
    this.saveData();

    console.log(`房间 ${roomId} 已创建，房主: ${player.name}`);
  }

  // 加入房间
  handleJoinRoom(ws, data) {
    const userId = this.wsToUser.get(ws);
    if (!userId) {
      ws.send(JSON.stringify({ type: 'error', message: '请先加入游戏' }));
      return;
    }

    const { roomId } = data;
    const game = this.rooms.get(roomId);

    if (!game) {
      ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
      return;
    }

    const player = this.players.get(userId);

    // 如果玩家已在这个房间中（重连情况）
    if (player.roomId === roomId) {
      game.markPlayerOnline(userId);
      this.sendRoomState(ws, game);
      this.broadcastRoomState(game);
      console.log(`${player.name} 重新连接房间 ${roomId}`);
      return;
    }

    // 如果玩家在其他房间中
    if (player.roomId && player.roomId !== roomId) {
      const existingGame = this.rooms.get(player.roomId);
      if (existingGame && existingGame.state !== 'ended') {
        ws.send(JSON.stringify({ type: 'error', message: '您已在房间中' }));
        return;
      } else {
        // 清除已结束或不存在的房间
        player.roomId = null;
      }
    }

    if (game.state !== 'waiting') {
      ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
      return;
    }

    game.addPlayer(userId, player.name, false);
    player.roomId = roomId;

    this.broadcastRoomState(game);
    this.saveData();

    console.log(`${player.name} 加入房间 ${roomId}`);
  }

  // 离开房间
  handleLeaveRoom(ws) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game) return;

    game.removePlayer(userId);
    const roomId = player.roomId;
    player.roomId = null;

    ws.send(JSON.stringify({ type: 'left_room' }));

    // 如果房间为空，删除房间
    if (game.getPlayerCount() === 0) {
      this.rooms.delete(roomId);
      console.log(`房间 ${roomId} 已删除（无人）`);
    } else if (userId === game.hostId) {
      // 房主离开，解散房间（除非只是掉线？handleLeaveRoom通常是主动离开）
      // 这里的 handleLeaveRoom 是响应 ws type: 'leave_room'，是主动行为
      console.log(`房主 ${userId} 离开，解散房间 ${roomId}`);
      this.broadcast(game, {
        type: 'room_closed',
        data: { reason: '房主已解散房间' }
      });
      this.rooms.delete(roomId);

      // 清理所有玩家的房间状态
      game.players.forEach((p, pId) => {
        const globalPlayer = this.players.get(pId);
        if (globalPlayer) globalPlayer.roomId = null;
      });
    } else {
      // 检查是否所有真人玩家都离开了
      const humanCount = Array.from(game.players.values()).filter((p) => !p.isAI).length;
      if (humanCount === 0 && game.state === 'playing') {
        console.log(`房间 ${roomId} 所有真人已离开，自动结束游戏`);
        game.endGame({
          winner: 'none',
          reason: '所有真人玩家已离开'
        });
      } else {
        this.broadcastRoomState(game);
      }
    }

    this.saveData();
  }

  // 添加 AI 玩家
  handleAddAI(ws, data) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) {
      ws.send(JSON.stringify({ type: 'error', message: '您不在房间中' }));
      return;
    }

    const game = this.rooms.get(player.roomId);
    if (!game || game.hostId !== userId) {
      ws.send(JSON.stringify({ type: 'error', message: '只有房主可以添加 AI' }));
      return;
    }

    if (game.getPlayerCount() >= 12) {
      ws.send(JSON.stringify({ type: 'error', message: '房间人数已满（最多 12 人）' }));
      return;
    }

    const aiId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const aiNames = ['小明', '小红', '小刚', '小芳', '小强', '小丽', '小华', '小龙', '小凤', '小军', '小强', '小丽', '小华', '小龙', '小凤', '小小'];
    const existingNames = game.getPlayersInfo().map((p) => p.name);
    const availableNames = aiNames.filter((n) => !existingNames.includes(n));
    const aiName =
      availableNames.length > 0 ? availableNames[Math.floor(Math.random() * availableNames.length)] : `AI玩家${game.getPlayerCount() + 1}`;

    const llmPlayer = new LLMPlayer(aiId, aiName, this.config.llm);
    game.addPlayer(aiId, aiName, true, llmPlayer);

    this.broadcastRoomState(game);
    this.saveData();

    console.log(`AI 玩家 ${aiName} 已添加到房间 ${player.roomId}`);
  }

  handleRemoveAI(ws, data) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game || game.hostId !== userId) {
      ws.send(JSON.stringify({ type: 'error', message: '只有房主可以移除 AI' }));
      return;
    }

    // 寻找最近添加的一个 AI 玩家并移除
    const aiPlayers = Array.from(game.players.values()).filter(p => p.isAI);
    if (aiPlayers.length > 0) {
      const lastAI = aiPlayers[aiPlayers.length - 1];
      game.removePlayer(lastAI.id);
      this.broadcastRoomState(game);
      this.saveData();
      console.log(`AI 玩家 ${lastAI.name} 已从房间 ${player.roomId} 移除`);
    } else {
      ws.send(JSON.stringify({ type: 'error', message: '房间内没有 AI 玩家' }));
    }
  }

  // 开始游戏
  handleStartGame(ws) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game || game.hostId !== userId) {
      ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
      return;
    }

    const result = game.start();
    if (!result.success) {
      ws.send(JSON.stringify({ type: 'error', message: result.message }));
      return;
    }

    // 向每个玩家发送各自的角色信息
    game.players.forEach((p, pId) => {
      if (!p.isAI) {
        const playerData = this.players.get(pId);
        if (playerData && playerData.ws) {
          playerData.ws.send(
            JSON.stringify({
              type: 'game_started',
              data: {
                role: p.role.name,
                roleDescription: p.role.description,
                players: game.getPublicPlayersInfo()
              }
            })
          );
        }
      }
    });

    this.saveData();
    console.log(`房间 ${player.roomId} 游戏开始`);

    // 开始夜晚阶段
    game.startNight();
  }

  // 处理游戏操作
  handleGameAction(ws, data) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game) return;

    game.handleAction(userId, data);
  }

  // 处理聊天消息
  handleChat(ws, data) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game) return;

    const { message, isWolfChat } = data;
    game.handleChat(userId, message, isWolfChat);
  }

  // 断开连接
  handleDisconnect(ws) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (player) {
      // 不立即删除玩家，允许重连
      player.ws = null;

      // 通知房间其他人
      if (player.roomId) {
        const game = this.rooms.get(player.roomId);
        if (game) {
          game.markPlayerOffline(userId);
          this.broadcastRoomState(game);
        }
      }
    }

    this.wsToUser.delete(ws);
  }

  // 发送房间状态给单个玩家
  sendRoomState(ws, game) {
    const userId = this.wsToUser.get(ws);
    const playerInGame = game.players.get(userId);

    const roomStateData = {
      roomId: game.roomId,
      hostId: game.hostId,
      state: game.state,
      players: game.getPublicPlayersInfo(),
      currentPhase: game.currentPhase,
      dayNumber: game.dayNumber,
      myRole: playerInGame?.role?.name || null,
      messages: game.messages || [],
      wolfChatHistory: playerInGame?.role?.name === '狼人' ? game.wolfChatHistory || [] : [],
      speakingOrder: game.speakingOrder || [],
      currentSpeakerId: game.currentSpeakerId || null,
      isPaused: game.isPaused || false,
      countdown: game.currentCountdown || 0,
      myIsAlive: playerInGame ? playerInGame.isAlive : true
    };

    // 如果在夜晚且玩家存活且未行动，发送动作选项
    if (game.state === 'playing' && game.currentPhase === 'night' && playerInGame && playerInGame.isAlive && !playerInGame.isAI) {
      if (!game.nightActions[userId]) {
        const possibleTargets = playerInGame.role ? playerInGame.role.getPossibleTargets() : [];
        if (possibleTargets.length > 0) {
          roomStateData.actionRequired = {
            role: Object.keys(ROLE_NAME_MAP).find((k) => ROLE_NAME_MAP[k] === playerInGame.role.name),
            possibleTargets
          };
        }
      }
    }

    // 如果在投票阶段且玩家存活，发送候选人
    if (game.state === 'playing' && game.currentPhase === 'vote' && playerInGame && playerInGame.isAlive) {
      roomStateData.candidates = game.getAlivePlayers().map(([id, p]) => ({ id, name: p.name }));
    }

    // 如果有人正在发言且我是那个人，发送发言状态
    if (game.state === 'playing' && game.currentPhase === 'day' && game.currentSpeakerId) {
      const speaker = game.players.get(game.currentSpeakerId);
      if (speaker) {
        roomStateData.speakingTurn = {
          playerId: game.currentSpeakerId,
          playerName: speaker.name,
          index: game.currentSpeakerIndex,
          isHuman: !speaker.isAI,
          total: game.speakingOrder.length,
          timeout: !speaker.isAI ? 120 : 0
        };
      }
    }

    ws.send(JSON.stringify({ type: 'room_state', data: roomStateData }));
  }

  // 广播房间状态
  broadcastRoomState(game) {
    game.players.forEach((p, pId) => {
      if (!p.isAI) {
        const playerData = this.players.get(pId);
        if (playerData && playerData.ws) {
          this.sendRoomState(playerData.ws, game);
        }
      }
    });
  }

  // 向房间广播消息
  broadcast(game, message) {
    game.players.forEach((p, pId) => {
      if (!p.isAI) {
        const playerData = this.players.get(pId);
        if (playerData && playerData.ws) {
          playerData.ws.send(JSON.stringify(message));
        }
      }
    });
  }

  // 向特定玩家发送消息
  sendToPlayer(playerId, message) {
    const player = this.players.get(playerId);
    if (player && player.ws) {
      player.ws.send(JSON.stringify(message));
    }
  }

  // 生成房间 ID
  generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  }

  // 暂停游戏（仅房主）
  handlePauseGame(ws) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game || game.hostId !== userId) {
      ws.send(JSON.stringify({ type: 'error', message: '只有房主可以暂停游戏' }));
      return;
    }

    if (game.pauseGame()) {
      this.broadcastRoomState(game);
      console.log(`房间 ${player.roomId} 游戏已暂停`);
    }
  }

  // 恢复游戏（仅房主）
  handleResumeGame(ws) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game || game.hostId !== userId) {
      ws.send(JSON.stringify({ type: 'error', message: '只有房主可以恢复游戏' }));
      return;
    }

    if (game.resumeGame()) {
      this.broadcastRoomState(game);
      console.log(`房间 ${player.roomId} 游戏已恢复`);
    }
  }

  // 玩家退出游戏
  handleExitGame(ws) {
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    const player = this.players.get(userId);
    if (!player || !player.roomId) return;

    const game = this.rooms.get(player.roomId);
    if (!game) return;

    const gamePlayer = game.players.get(userId);
    if (gamePlayer) {
      // 标记玩家离线但保留在游戏中（AI可以接管）
      gamePlayer.isOnline = false;
      game.updateActivity();

      this.broadcast(game, {
        type: 'player_exited',
        data: { playerId: userId, playerName: gamePlayer.name }
      });

      // 房主退出，解散房间
      if (userId === game.hostId) {
        console.log(`房主 ${userId} 退出，解散房间 ${player.roomId}`);
        this.broadcast(game, {
          type: 'room_closed',
          data: { reason: '房主已解散房间' }
        });
        this.rooms.delete(player.roomId);

        // 清理所有玩家的房间状态
        game.players.forEach((p, pId) => {
          const globalPlayer = this.players.get(pId);
          if (globalPlayer) globalPlayer.roomId = null;
        });
      }
      // 否则检查是否所有真人玩家都退出了
      else {
        const humanCount = Array.from(game.players.values()).filter((p) => !p.isAI && p.isOnline).length;
        if (humanCount === 0 && game.state === 'playing') {
          console.log(`房间 ${player.roomId} 所有真人已退出，自动结束游戏`);
          game.endGame({
            winner: 'none',
            reason: '所有真人玩家已退出'
          });
        }
      }
    }

    // 清除玩家的房间信息
    player.roomId = null;

    ws.send(JSON.stringify({ type: 'exited_game' }));
    this.broadcastRoomState(game);
    this.saveData();

    console.log(`玩家 ${player.name} 退出游戏`);
  }
}
