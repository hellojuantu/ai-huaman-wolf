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

// 角色英文名到中文名的映射
const ROLE_NAME_MAP = {
  wolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  idiot: '白痴',
  villager: '平民'
};

export class Game {
  constructor(roomId, hostId, config, manager) {
    this.roomId = roomId;
    this.hostId = hostId;
    this.config = config;
    this.manager = manager;

    this.players = new Map(); // odityUserId -> Player对象
    this.state = 'waiting'; // waiting, playing, ended
    this.currentPhase = null; // night, day, vote
    this.dayNumber = 0;

    this.nightActions = {}; // 存储夜晚行动
    this.votes = {}; // 存储投票
    this.lastGuarded = null; // 上一晚守卫守护的人
    this.deadTonight = null; // 今晚将被杀的人
    this.pendingHunterShot = null; // 待处理的猎人开枪状态

    this.messages = []; // 游戏消息记录
    this.phaseTimer = null;
    this.countdownTimer = null;
    this.currentCountdown = 0;
    this.loopSessionId = 0; // 用于取消旧循环
  }

  // 添加玩家
  addPlayer(userId, name, isAI, llmPlayer = null) {
    this.players.set(userId, {
      id: userId,
      name,
      isAI,
      llmPlayer,
      role: null,
      isAlive: true,
      isOnline: true,
      canVote: true
    });
  }

  // 移除玩家
  removePlayer(userId) {
    this.players.delete(userId);
    // 如果是房主离开，转让房主
    if (userId === this.hostId) {
      const remaining = Array.from(this.players.keys()).filter((id) => {
        const p = this.players.get(id);
        return !p.isAI;
      });
      if (remaining.length > 0) {
        this.hostId = remaining[0];
      }
    }
  }

  // 标记玩家离线
  markPlayerOffline(userId) {
    const player = this.players.get(userId);
    if (player) {
      player.isOnline = false;
    }
  }

  // 标记玩家在线
  markPlayerOnline(userId) {
    const player = this.players.get(userId);
    if (player) {
      player.isOnline = true;
    }
  }

  // 获取玩家数量
  getPlayerCount() {
    return this.players.size;
  }

  // 获取玩家信息（公开）
  getPublicPlayersInfo() {
    return Array.from(this.players.entries()).map(([id, p]) => ({
      id,
      name: p.name,
      isAI: p.isAI,
      isAlive: p.isAlive,
      isOnline: p.isOnline
    }));
  }

  // 获取玩家信息（详细）
  getPlayersInfo() {
    return Array.from(this.players.entries()).map(([id, p]) => ({
      id,
      name: p.name,
      isAI: p.isAI,
      role: p.role?.name || null
    }));
  }

  // 开始游戏
  start() {
    const playerCount = this.players.size;

    // 检查人数
    const validCounts = Object.keys(this.config.game.roleConfigs).map(Number);
    if (!validCounts.includes(playerCount)) {
      return {
        success: false,
        message: `玩家人数不对，支持的人数: ${validCounts.join(', ')}`
      };
    }

    // 分配角色
    this.assignRoles(playerCount);

    this.state = 'playing';
    this.dayNumber = 0;

    return { success: true };
  }

  // 分配角色
  assignRoles(playerCount) {
    const roleConfig = this.config.game.roleConfigs[playerCount];
    const roles = [];

    // 生成角色列表
    Object.entries(roleConfig).forEach(([roleName, count]) => {
      for (let i = 0; i < count; i++) {
        roles.push(roleName);
      }
    });

    // 打乱角色
    this.shuffleArray(roles);

    // 分配给玩家
    let i = 0;
    this.players.forEach((player, playerId) => {
      const roleName = roles[i++];
      const RoleClass = ROLE_CLASSES[roleName];
      player.role = new RoleClass(playerId, this);
    });
  }

  // 开始夜晚
  async startNight() {
    this.dayNumber++;
    this.currentPhase = 'night';
    this.nightActions = {};
    this.deadTonight = null;
    this.wolfChatHistory = []; // 重置狼人聊天历史
    this.currentPhaseWolfDiscussed = false; // 重置讨论标记
    this.isResolvingNight = false; // 重置结算标记

    this.addMessage('system', `第 ${this.dayNumber} 夜开始，请闭眼。`);

    this.manager.broadcast(this, {
      type: 'phase_change',
      data: {
        phase: 'night',
        dayNumber: this.dayNumber
      }
    });

    // 通知各角色行动（同步执行，不火并忘）
    this.isLoopRunning = true;
    try {
      await this.promptNightActions();
    } finally {
      this.isLoopRunning = false;
    }
  }

  // 提示夜晚行动
  async promptNightActions() {
    // 记录当前 session，用于检测循环是否被取代
    this.loopSessionId++;
    const mySessionId = this.loopSessionId;
    const checkSession = () => mySessionId === this.loopSessionId && this.state === 'playing';

    const actionOrder = ['guard', 'wolf', 'witch', 'seer'];

    for (const roleName of actionOrder) {
      // 检查循环是否被取代
      if (!checkSession()) {
        console.log(`[Night] promptNightActions 循环被取代，停止 (session: ${mySessionId} vs ${this.loopSessionId})`);
        return;
      }

      const players = this.getAlivePlayersByRole(roleName);

      for (const [playerId, player] of players) {
        // 再次检查
        if (!checkSession()) return;

        // 如果是狼人，先进行内部交流
        if (roleName === 'wolf' && players.length > 1) {
          await this.handleWolfDiscussion(players);
        }

        // 检查是否已经行动过（防止重复）
        if (this.nightActions[playerId]) continue;

        if (player.isAI && player.llmPlayer) {
          // AI 玩家自动行动
          const action = await this.getAIAction(player, roleName);
          if (action && checkSession()) {
            this.handleAction(playerId, action);
          }
        } else {
          // 人类玩家，发送行动提示
          this.manager.sendToPlayer(playerId, {
            type: 'action_required',
            data: {
              role: roleName,
              possibleTargets: this.getPossibleTargets(playerId, roleName)
            }
          });
        }
      }

      // 等待人类玩家行动（简化处理，实际可用超时机制）
      await this.waitForActions(roleName);

      // 如果是狼人回合结束，立即计算击杀目标，以便女巫可以看到
      if (roleName === 'wolf' && checkSession()) {
        this.deadTonight = this.calculateWolfKill();
        const deadPlayer = this.deadTonight ? this.players.get(this.deadTonight) : null;
        console.log(`[Game] 狼人回合结束，今晚死者: ${deadPlayer ? deadPlayer.name : '无'}`);
      }
    }

    // 结算夜晚
    if (checkSession()) {
      this.resolveNight();
    }
  }

  // 等待行动（简化版）
  waitForActions(roleName) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const players = this.getAlivePlayersByRole(roleName);
        let allActed = true;

        for (const [playerId] of players) {
          if (!this.nightActions[playerId]) {
            const player = this.players.get(playerId);
            if (!player.isAI) {
              allActed = false;
              break;
            }
          }
        }

        if (allActed) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);

      // 超时自动结束（30秒）
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 30000);
    });
  }

  // 获取 AI 玩家行动
  async getAIAction(player, roleName) {
    try {
      const { gameState, idMap } = this.getGameStateForAI(player.id);
      const decision = await player.llmPlayer.decide(roleName, gameState);

      // 将决策中的可能掩码 ID 转换回原始 ID
      if (decision && decision.target && idMap[decision.target]) {
        decision.target = idMap[decision.target];
      }

      // 特殊处理女巫救人：AI 不再知道死者 ID，所以如果返回 save，自动补全目标
      if (roleName === 'witch' && decision && decision.action === 'save' && !decision.target) {
        decision.target = this.deadTonight;
      }

      return decision;
    } catch (err) {
      console.error('AI 行动失败:', err);
      return null;
    }
  }

  // 处理 AI 玩家夜晚行动
  async handleAINightAction(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.role || !player.isAI || !player.llmPlayer) return;

    const roleKey = Object.keys(ROLE_NAME_MAP).find((k) => ROLE_NAME_MAP[k] === player.role.name);
    const action = await this.getAIAction(player, roleKey);
    if (action) {
      this.handleAction(playerId, action);
    }
  }

  // 检查夜晚是否结束
  checkNightComplete() {
    // 防止重复结算
    if (this.isResolvingNight) return;

    const aliveSpecialRoles = this.getAlivePlayers().filter(([id, p]) => p.role && ['狼人', '预言家', '女巫', '守卫'].includes(p.role.name));

    let allActed = true;
    for (const [playerId, player] of aliveSpecialRoles) {
      if (!this.nightActions[playerId]) {
        allActed = false;
        break;
      }
    }

    if (allActed) {
      this.isResolvingNight = true;
      console.log('[Game] 所有玩家已完成夜晚行动，正在结算...');
      this.resolveNight();
    }
  }

  // 获取可选目标
  getPossibleTargets(playerId, roleName) {
    const player = this.players.get(playerId);
    return player.role.getPossibleTargets();
  }

  // 处理玩家行动
  handleAction(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return;

    const { action, target } = data;

    // 特殊处理：猎人开枪（即使已经死亡）
    if (action === 'hunter_shoot' && this.pendingHunterShot === playerId) {
      if (player.role && typeof player.role.shoot === 'function') {
        console.log(`[Game] 猎人 ${player.name} 开枪带走 ${target}`);
        player.role.shoot(target);

        // 检查游戏结束（猎人开枪可能导致局势突变）
        const gameEnd = this.checkGameEnd();
        if (gameEnd) {
          this.endGame(gameEnd);
        }
        return;
      }
    }

    if (action === 'end_speech') {
      if (this.pendingSpeakResolve && this.pendingSpeakResolve.playerId === playerId) {
        this.pendingSpeakResolve.resolve();
      }
      return;
    }

    if (!player.isAlive) return;

    if (this.currentPhase === 'night') {
      this.nightActions[playerId] = { action, target };

      // 处理特定技能
      if (player.role && typeof player.role.onAction === 'function') {
        const targetPlayer = target ? this.players.get(target) : null;
        const targetInfo = targetPlayer ? `${targetPlayer.name} (${targetPlayer.role?.name || '未知'})` : target || '无';
        const reasonStr = data.reason ? ` | 原因: ${data.reason}` : '';
        console.log(`[Game] 处理 ${player.name} (${player.role.constructor.roleName}) 的行动: ${action} ${targetInfo}${reasonStr}`);

        const result = player.role.onAction(action, target);
        console.log(`[Game] Action result:`, result);

        if (result && !player.isAI) {
          console.log(`[Game] Sending action result to ${player.name}`);
          this.manager.sendToPlayer(playerId, {
            type: 'action_result',
            data: result
          });
        }
      }
      this.checkNightComplete();
    } else if (this.currentPhase === 'vote') {
      this.votes[playerId] = target;
      this.checkVoteComplete();
    }
  }

  // 处理狼人讨论
  async handleWolfDiscussion(wolfPlayers) {
    // 如果已经讨论过（避免每个狼人循环时重复讨论），标记一下
    if (this.currentPhaseWolfDiscussed) return;
    this.currentPhaseWolfDiscussed = true;

    console.log('[Game] 开始狼人夜间交流...');

    // 发送系统提示给狼人
    const sysMsg = '🐺 狼人请睁眼。你们可以在这里密谋今晚的战术。';
    // 只能发给狼人玩家
    this.players.forEach((p, pId) => {
      if (p.role?.name === '狼人' && !p.isAI) {
        this.manager.sendToPlayer(pId, {
          type: 'wolf_chat',
          data: { from: 'system', message: sysMsg }
        });
      }
    });
    // 同时也记录到历史，供 AI 参考
    if (!this.wolfChatHistory) this.wolfChatHistory = [];
    this.wolfChatHistory.push({ from: 'system', content: sysMsg, time: Date.now() });

    const hasHumanWolf = wolfPlayers.some(([_, p]) => !p.isAI);
    const discussionDuration = hasHumanWolf ? 30000 : 0; // 如果有真人狼，给30秒讨论时间；全AI则直接快速跑完

    // AI 发言逻辑
    const performAIWolfChat = async () => {
      // 简单的交流轮次：每人发言 1-2 次
      const rounds = 2;
      const speakingOrder = Array.from(wolfPlayers).filter(([_, p]) => p.isAI); // 只有 AI 主动发言

      for (let r = 0; r < rounds; r++) {
        for (const [playerId, player] of speakingOrder) {
          if (player.isAlive) {
            try {
              // 随机延迟，模拟思考，也给人类玩家插话的机会
              // 增加随机性：有时候快，有时候慢
              const thinkingDelay = 1000 + Math.random() * (player.isAI ? 3000 : 1000);
              await this.sleep(thinkingDelay);

              const { gameState } = this.getGameStateForAI(playerId);

              const speechResult = await player.llmPlayer.wolfSpeak(gameState);
              const messages = speechResult?.messages || [];

              if (messages.length > 0) {
                for (const msg of messages) {
                  if (!msg || typeof msg !== 'string') continue;

                  const trimmedMsg = msg.trim();
                  if (!trimmedMsg) continue;

                  // 增强去重：检查该玩家在此轮是否说过完全相同的话
                  const isDuplicate = (this.wolfChatHistory || []).some((m) => m.from === player.name && m.content.trim() === trimmedMsg);
                  if (isDuplicate) continue;

                  // 发送给所有狼人 (Human & AI)
                  console.log(`[Wolf Chat] ${player.name}: ${trimmedMsg}`);
                  this.handleChat(playerId, trimmedMsg, true);

                  // 消息之间的小间隙
                  await this.sleep(800 + Math.random() * 400);
                }
              }
            } catch (err) {
              console.error(`AI Wolf ${player.name} discussion failed:`, err);
            }
          }
        }
      }
    };

    if (hasHumanWolf) {
      // 启动倒计时提示
      this.manager.broadcast(this, {
        type: 'countdown',
        data: { seconds: discussionDuration / 1000 }
      });

      // 并行执行 AI 聊天和等待
      const aiChatPromise = performAIWolfChat();
      const waitPromise = this.sleep(discussionDuration);

      await Promise.all([aiChatPromise, waitPromise]);

      // 结束提示
      this.players.forEach((p, pId) => {
        if (p.role?.name === '狼人' && !p.isAI) {
          this.manager.sendToPlayer(pId, {
            type: 'wolf_chat',
            data: { from: 'system', message: '🐺 讨论结束，请选择击杀目标。' }
          });
        }
      });
    } else {
      // 全 AI，直接跑完
      await performAIWolfChat();
    }

    console.log('[Game] 狼人夜间交流结束');
  }

  // 计算狼人击杀目标
  calculateWolfKill() {
    // 狼人杀人
    const wolfActions = Object.entries(this.nightActions).filter(([id]) => this.players.get(id)?.role?.name === '狼人');

    if (wolfActions.length > 0) {
      // 统计狼人票数
      const killVotes = {};
      wolfActions.forEach(([, data]) => {
        if (data.target) {
          killVotes[data.target] = (killVotes[data.target] || 0) + 1;
        }
      });

      // 找出票数最多的目标
      let maxVotes = 0;
      let target = null;
      Object.entries(killVotes).forEach(([t, votes]) => {
        if (votes > maxVotes) {
          maxVotes = votes;
          target = t;
        }
      });

      return target;
    }
    return null;
  }

  // 结算夜晚
  resolveNight() {
    let killed = this.deadTonight; // 使用已经在 promptNightActions 中计算的结果
    let saved = false;
    let poisoned = null;

    // 如果没有预先计算（兼容性），则重新计算
    if (killed === undefined) {
      killed = this.calculateWolfKill();
    }

    // 守卫守护
    const guardAction = Object.entries(this.nightActions).find(([id]) => this.players.get(id)?.role?.name === '守卫');

    if (guardAction) {
      const guardedTarget = guardAction[1].target;
      if (guardedTarget === killed && guardedTarget !== this.lastGuarded) {
        saved = true;
        killed = null;
      }
      this.lastGuarded = guardedTarget;
    }

    // 女巫行动
    const witchAction = Object.entries(this.nightActions).find(([id]) => this.players.get(id)?.role?.name === '女巫');

    if (witchAction) {
      const witch = this.players.get(witchAction[0]);
      const { action, target } = witchAction[1];

      // 女巫救人逻辑：需要有解药，且目标是当前死者
      // 额外规则：第一晚之后不能自救
      const isSelfSave = target === witch.id;
      const canSelfSave = this.dayNumber === 1;

      if (action === 'save' && killed && witch.role.hasAntidote) {
        if (!isSelfSave || canSelfSave) {
          witch.role.hasAntidote = false;
          saved = true;
          killed = null;
        } else {
          console.log(`[Game] 女巫 ${witch.name} 尝试在第 ${this.dayNumber} 晚自救被拦截`);
        }
      } else if (action === 'poison' && target && witch.role.hasPoison) {
        witch.role.hasPoison = false;
        poisoned = target;
      }
    }

    // 执行死亡
    const deaths = [];
    if (killed && !saved) {
      this.killPlayer(killed, 'wolf');
      deaths.push({ id: killed, cause: 'wolf' });
    }
    if (poisoned) {
      this.killPlayer(poisoned, 'poison');
      deaths.push({ id: poisoned, cause: 'poison' });
    }

    // 检查游戏结束
    const gameEnd = this.checkGameEnd();
    if (gameEnd) {
      this.endGame(gameEnd);
      return;
    }

    // 进入白天
    this.startDay(deaths);
  }

  // 杀死玩家
  killPlayer(playerId, cause) {
    const player = this.players.get(playerId);
    if (!player) return;

    player.isAlive = false;
    console.log(`[Game] Player ${player.name} (${player.role.constructor.roleName}) was killed by ${cause}. isAlive set to false.`);

    // 触发死亡技能
    if (player.role && typeof player.role.onDeath === 'function') {
      player.role.onDeath(cause);
    }
  }

  // 开始白天
  async startDay(deaths) {
    this.currentPhase = 'day';

    let deathMessage = '昨夜是平安夜，没有人死亡。';
    if (deaths.length > 0) {
      const deathNames = deaths.map((d) => {
        const p = this.players.get(d.id);
        return p ? p.name : '未知';
      });
      deathMessage = `昨夜死亡: ${deathNames.join(', ')}`;
    }

    this.addMessage('host', `[主持人] 天亮了！${deathMessage}`);
    this.manager.broadcast(this, {
      type: 'chat',
      data: { from: 'host', message: `[主持人] 天亮了！${deathMessage}` }
    });

    this.addMessage('host', `[主持人] 请各位玩家依次发言，讨论时间 ${this.config.game.discussionTime} 秒。`);
    this.manager.broadcast(this, {
      type: 'chat',
      data: { from: 'host', message: `[主持人] 请各位玩家依次发言，讨论时间 ${this.config.game.discussionTime} 秒。` }
    });

    this.manager.broadcast(this, {
      type: 'phase_change',
      data: {
        phase: 'day',
        dayNumber: this.dayNumber,
        deaths,
        discussionTime: this.config.game.discussionTime
      }
    });

    // AI 玩家发言
    await this.handleAISpeech();

    // 开始倒计时 - 已移除，改为直接进入投票
    // this.startCountdown(this.config.game.discussionTime, () => {
    //     this.startVote();
    // });

    // 稍微延迟后直接进入投票
    await this.sleep(3000);
    this.startVote();
  }

  // AI 玩家发言
  async handleAISpeech() {
    // 记录当前 session，用于检测循环是否被取代
    this.loopSessionId++;
    const mySessionId = this.loopSessionId;
    const checkSession = () => mySessionId === this.loopSessionId;

    const alivePlayers = this.getAlivePlayers();
    this.speakingOrder = Array.from(alivePlayers).map(([id]) => id);
    this.currentSpeakerIndex = 0;

    // 广播发言开始
    this.addMessage('system', `📢 讨论开始，请各位依次发言`);
    this.manager.broadcast(this, {
      type: 'chat',
      data: { from: 'system', message: '📢 讨论开始，请各位依次发言' }
    });

    await this.sleep(1500);

    for (const playerId of this.speakingOrder) {
      // 检查循环是否被取代或游戏已结束
      if (!checkSession() || this.state === 'ended') {
        console.log(
          `[Speaking] handleAISpeech 循环被取代或游戏结束，停止发言 (session: ${mySessionId} vs ${this.loopSessionId}, state: ${this.state})`
        );
        return;
      }

      const player = this.players.get(playerId);
      if (!player || !player.isAlive) continue;

      this.currentSpeakerId = playerId;
      this.currentSpeakerIndex++;

      // 广播轮到谁发言
      this.manager.broadcast(this, {
        type: 'speaking_turn',
        data: {
          playerId: playerId,
          playerName: player.name,
          index: this.currentSpeakerIndex,
          isHuman: !player.isAI,
          total: this.speakingOrder.length,
          timeout: !player.isAI ? 120 : 0 // 告诉前端超时时间
        }
      });

      if (player.isAI && player.llmPlayer && player.isAlive) {
        try {
          await this.sleep(800); // 等待UI更新
          if (!checkSession()) return;

          const { gameState } = this.getGameStateForAI(playerId);
          gameState.speakingCount = this.currentSpeakerIndex;
          gameState.totalPlayers = this.speakingOrder.length;

          const speechData = await player.llmPlayer.speak(gameState);
          if (!checkSession()) return;

          // 兼容旧的字符串返回，如果不幸返回了字符串
          const messages = typeof speechData === 'string' ? [speechData] : speechData?.messages || [];

          if (messages.length > 0) {
            for (const msg of messages) {
              if (!msg) continue;
              if (!checkSession()) return;

              this.addMessage(player.name, msg);
              this.manager.broadcast(this, {
                type: 'chat',
                data: { from: player.name, message: msg }
              });

              // 随机延迟 4-6 秒，让人类有时间阅读
              const delay = 4000 + Math.random() * 2000;
              await this.sleep(delay);
              if (!checkSession()) return;
            }
          } else {
            // AI 放弃发言
            await this.sleep(1000);
            if (!checkSession()) return;
          }
        } catch (err) {
          console.error('AI 发言失败:', err);
          await this.sleep(500);
        }
      } else if (!player.isAI && player.isAlive) {
        // 记录当前消息数量，用于判断玩家是否发言
        const initialMsgCount = this.messages.length;

        // 人类玩家 - 等待发言或超时 (120秒)
        // 注意：这里我们不再在第一条消息时resolve，而是等待超时或明确结束
        await this.waitForHumanSpeak(playerId, 120000);
        if (!checkSession()) return;

        // 检查玩家是否发言
        let hasSpoken = false;
        for (let i = initialMsgCount; i < this.messages.length; i++) {
          if (this.messages[i].from === player.name) {
            hasSpoken = true;
            break;
          }
        }

        if (!hasSpoken) {
          const silenceMsg = `${player.name} 结束了发言，没有说什么。`;
          this.addMessage('system', silenceMsg);
          this.manager.broadcast(this, {
            type: 'chat',
            data: { from: 'system', message: silenceMsg }
          });
        }
      }
    }

    // 广播发言结束
    this.addMessage('system', `📢 发言结束，即将开始投票`);
    this.manager.broadcast(this, {
      type: 'chat',
      data: { from: 'system', message: '📢 发言结束，即将开始投票' }
    });
    this.currentSpeakerId = null;
    this.currentSpeakerIndex = 0;
    await this.sleep(1000);
  }

  // 等待人类玩家发言（或超时）
  waitForHumanSpeak(playerId, timeout) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        // 超时自动跳过
        this.pendingSpeakResolve = null;
        resolve();
      }, timeout);

      // 存储 resolve 以便 handleChat 可以触发
      this.pendingSpeakResolve = {
        playerId,
        resolve: () => {
          clearTimeout(timeoutId);
          this.pendingSpeakResolve = null;
          resolve();
        }
      };
    });
  }

  // 倒计时
  startCountdown(seconds, callback) {
    this.currentCountdown = seconds;

    // 清除旧的定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }

    // 发送初始倒计时
    this.manager.broadcast(this, {
      type: 'countdown',
      data: { seconds: this.currentCountdown }
    });

    this.countdownTimer = setInterval(() => {
      this.currentCountdown--;

      this.manager.broadcast(this, {
        type: 'countdown',
        data: { seconds: this.currentCountdown }
      });

      if (this.currentCountdown <= 0) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        callback();
      }
    }, 1000);
  }

  // 辅助函数：延迟
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 开始投票
  startVote() {
    this.currentPhase = 'vote';
    this.votes = {};

    this.addMessage('host', `【主持人】发言结束！请投票选出今天要放逐的玩家，投票时间 ${this.config.game.voteTime} 秒。`);

    const alivePlayers = this.getAlivePlayers();

    this.manager.broadcast(this, {
      type: 'phase_change',
      data: {
        phase: 'vote',
        dayNumber: this.dayNumber,
        candidates: alivePlayers.map(([id, p]) => ({ id, name: p.name })),
        voteTime: this.config.game.voteTime
      }
    });

    // AI 玩家自动投票
    this.handleAIVotes();

    // 开始投票倒计时
    this.startCountdown(this.config.game.voteTime, async () => {
      await this.resolveVote();
    });
  }

  // AI 投票
  async handleAIVotes() {
    console.log('[Game] Starting AI voting process...');
    const alivePlayers = this.getAlivePlayers();

    // 使用 Promise.all 并行处理所有 AI 投票
    const votePromises = [];

    for (const [playerId, player] of alivePlayers) {
      if (player.isAI && player.llmPlayer && player.canVote) {
        votePromises.push(
          (async () => {
            try {
              console.log(`[Game] requesting vote from AI ${player.name}...`);
              const { gameState, idMap } = this.getGameStateForAI(playerId);
              const decision = await player.llmPlayer.vote(gameState);

              console.log(`[Game] AI ${player.name} vote decision:`, decision);

              if (decision && decision.target) {
                let targetId = decision.target;
                if (idMap[targetId]) targetId = idMap[targetId];
                this.votes[playerId] = targetId;
                const targetPlayer = this.players.get(targetId);
                const targetInfo = targetPlayer ? `${targetPlayer.name} (${targetPlayer.role?.name || '未知'})` : targetId;
                console.log(`[Game] AI ${player.name} (${player.role?.name || '未知'}) voted for ${targetInfo}`);
                // 每次AI投票后检查是否完成
                this.checkVoteComplete();
              } else {
                console.warn(`[Game] AI ${player.name} (${player.role?.name || player.role}) returned invalid vote decision`);
              }
            } catch (err) {
              console.error(`[Game] AI ${player.name} (${player.role}) voting failed:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(votePromises);
    console.log('[Game] All AI votes processed');

    // 统计投票结果用于日志显示
    const voteCount = {};
    Object.values(this.votes).forEach((target) => {
      voteCount[target] = (voteCount[target] || 0) + 1;
    });

    let maxVotes = 0;
    let eliminated = null;
    let tie = false;

    Object.entries(voteCount).forEach(([playerId, votes]) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminated = playerId;
        tie = false;
      } else if (votes === maxVotes) {
        tie = true;
      }
    });

    if (tie || maxVotes === 0) {
      console.log(`[Game] Vote Result: Tie or no votes. No one eliminated.`);
    } else if (eliminated) {
      const victim = this.players.get(eliminated);
      const victimInfo = victim ? `${victim.name} (${victim.role?.name})` : eliminated;
      console.log(`[Game] Vote Result: ${victimInfo} received ${maxVotes} votes and was eliminated.`);
    }
  }

  // 检查投票是否完成
  async checkVoteComplete() {
    const alivePlayers = this.getAlivePlayers().filter(([, p]) => p.canVote);
    const votedCount = Object.keys(this.votes).length;

    if (votedCount >= alivePlayers.length) {
      clearTimeout(this.phaseTimer);
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      // 广播倒计时结束
      this.manager.broadcast(this, {
        type: 'countdown',
        data: { seconds: 0, hide: true }
      });
      await this.resolveVote();
    }
  }

  // 结算投票
  async resolveVote() {
    const voteCount = {};

    Object.values(this.votes).forEach((target) => {
      voteCount[target] = (voteCount[target] || 0) + 1;
    });

    // 找出票数最多的玩家
    let maxVotes = 0;
    let eliminated = null;
    let tie = false;

    Object.entries(voteCount).forEach(([playerId, votes]) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminated = playerId;
        tie = false;
      } else if (votes === maxVotes) {
        tie = true;
      }
    });

    if (tie || maxVotes === 0) {
      this.addMessage('system', '投票平票或无人投票，没有人被放逐。');
    } else {
      const player = this.players.get(eliminated);

      // 检查白痴技能
      if (player.role?.name === '白痴' && player.role.canReveal) {
        player.role.canReveal = false;
        player.canVote = false;
        this.addMessage('system', `${player.name} 是白痴，展示身份后免于放逐，但失去投票权。`);

        this.manager.broadcast(this, {
          type: 'vote_result',
          data: {
            eliminated: null,
            revealed: { id: eliminated, name: player.name, role: '白痴' },
            voteCount
          }
        });
      } else {
        this.killPlayer(eliminated, 'vote');
        this.addMessage('system', `${player.name} 被放逐了。`);

        this.manager.broadcast(this, {
          type: 'vote_result',
          data: {
            eliminated: { id: eliminated, name: player.name },
            voteCount
          }
        });
      }
    }

    // 检查游戏结束
    const gameEnd = this.checkGameEnd();
    if (gameEnd) {
      this.endGame(gameEnd);
      return;
    }

    // 进入夜晚
    await this.startNight();
  }

  // 检查游戏结束
  checkGameEnd() {
    const alive = this.getAlivePlayers();

    let wolfCount = 0;
    let godCount = 0;
    let villagerCount = 0;

    alive.forEach(([, player]) => {
      const roleName = player.role?.name;
      if (roleName === '狼人') {
        wolfCount++;
      } else if (['预言家', '女巫', '猎人', '守卫', '白痴'].includes(roleName)) {
        godCount++;
      } else {
        villagerCount++;
      }
    });

    // 狼人全灭 - 好人胜利
    if (wolfCount === 0) {
      return { winner: 'villager', reason: '所有狼人被消灭' };
    }

    // 好人全灭 - 狼人胜利
    if (godCount === 0 || villagerCount === 0) {
      return { winner: 'wolf', reason: '屠边成功' };
    }

    // 狼人数量 >= 好人数量 - 狼人胜利
    if (wolfCount >= godCount + villagerCount) {
      return { winner: 'wolf', reason: '狼人数量达到或超过好人' };
    }

    return null;
  }

  // 结束游戏
  endGame(result) {
    this.state = 'ended';
    this.currentPhase = null;

    const winnerText = result.winner === 'wolf' ? '狼人阵营' : '好人阵营';
    this.addMessage('system', `游戏结束！${winnerText}获胜！原因: ${result.reason}`);

    // 揭示所有角色
    const allRoles = Array.from(this.players.entries()).map(([id, p]) => ({
      id,
      name: p.name,
      role: p.role?.name || '未知',
      isAlive: p.isAlive
    }));

    this.manager.broadcast(this, {
      type: 'game_ended',
      data: {
        winner: result.winner,
        reason: result.reason,
        players: allRoles
      }
    });
  }

  // 处理聊天
  handleChat(playerId, message, isWolfChat = false) {
    const player = this.players.get(playerId);
    if (!player) return;

    // 自动识别狼人频道消息（可选：在夜晚，如果是狼人发言，默认进狼人频道）
    if (this.currentPhase === 'night' && player.role?.name === '狼人' && this.state === 'playing') {
      isWolfChat = true;
    }

    if (isWolfChat) {
      // 狼人频道，只有狼人能看到
      if (player.role?.name !== '狼人') return;

      // 记录到狼人交流历史，以便 AI 能够看到
      if (!this.wolfChatHistory) this.wolfChatHistory = [];
      this.wolfChatHistory.push({ from: player.name, content: message, time: Date.now() });

      this.players.forEach((p, pId) => {
        if (p.role?.name === '狼人' && !p.isAI) {
          this.manager.sendToPlayer(pId, {
            type: 'wolf_chat',
            data: { from: player.name, message }
          });
        }
      });
    } else {
      // 公共频道
      if (this.currentPhase !== 'day' && this.state === 'playing') {
        // 夜晚不能说话
        return;
      }

      // 只有存活玩家能说话
      if (!player.isAlive && this.state === 'playing') {
        this.manager.sendToPlayer(playerId, {
          type: 'error',
          message: '你已死亡，无法发言'
        });
        return;
      }

      this.addMessage(player.name, message);

      this.manager.broadcast(this, {
        type: 'chat',
        data: { from: player.name, message }
      });

      // 注意：不再自动结束发言，需要玩家手动点击“结束发言”
    }
  }

  // 添加消息
  addMessage(from, content) {
    this.messages.push({
      from,
      content,
      time: Date.now()
    });
  }

  // 获取存活玩家
  getAlivePlayers() {
    return Array.from(this.players.entries()).filter(([, p]) => p.isAlive);
  }

  // 按角色获取存活玩家
  getAlivePlayersByRole(roleName) {
    const chineseRoleName = ROLE_NAME_MAP[roleName];
    return Array.from(this.players.entries()).filter(([, p]) => {
      return p.isAlive && p.role?.name === chineseRoleName;
    });
  }

  // 获取 AI 游戏状态
  getGameStateForAI(playerId) {
    const player = this.players.get(playerId);
    const isWolf = player.role?.name === '狼人';

    // 生成 ID 掩码 (掩盖 ai_ / user_ 前缀)
    const idMap = {}; // masked -> original
    const reverseIdMap = {}; // original -> masked
    const playersList = Array.from(this.players.keys());
    playersList.forEach((id, index) => {
      const maskedId = `p${index + 1}`;
      idMap[maskedId] = id;
      reverseIdMap[id] = maskedId;
    });

    // 过滤和优化消息历史
    let rawMessages = [...this.messages];
    if (isWolf && this.wolfChatHistory) {
      rawMessages = [...rawMessages, ...this.wolfChatHistory];
      rawMessages.sort((a, b) => (a.time || 0) - (b.time || 0));
    }

    const filteredMessages = rawMessages
      .filter((m) => {
        // 过滤掉包含 "AI 玩家" 或 "已添加到房间" 的系统消息
        if (m.from === 'system' || m.from === 'host') {
          if (m.content.includes('已添加到房间') || m.content.includes('AI 玩家') || m.content.includes('房主')) {
            return false;
          }
        }
        return true;
      })
      .slice(-25)
      .map((m) => ({
        from: m.from,
        content: m.content
      }));

    return {
      gameState: {
        dayNumber: this.dayNumber,
        phase: this.currentPhase,
        myRole: player.role?.name,
        roleState: player.role?.toJSON ? player.role.toJSON() : {},
        deadTonight: this.deadTonight ? reverseIdMap[this.deadTonight] : null,
        lastGuarded: this.lastGuarded ? reverseIdMap[this.lastGuarded] : null,
        alivePlayers: this.getAlivePlayers().map(([id, p]) => ({
          id: reverseIdMap[id],
          name: p.name,
          isMe: id === playerId,
          role: isWolf && p.role?.name === '狼人' ? '狼人' : '未知'
        })),
        messages: filteredMessages,
        myTeammates: isWolf ? this.getAlivePlayersByRole('wolf').map(([id, p]) => ({ id: reverseIdMap[id], name: p.name })) : null,
        speakingOrder: this.speakingOrder
          ? this.speakingOrder.map((id) => ({
              id: reverseIdMap[id],
              name: this.players.get(id)?.name,
              isMe: id === playerId
            }))
          : []
      },
      idMap: idMap, // masked -> original
      reverseIdMap: reverseIdMap // original -> masked
    };
  }

  // 打乱数组
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // 序列化游戏状态（完整 Checkpoint）
  toJSON() {
    const playersData = [];
    this.players.forEach((player, id) => {
      playersData.push({
        id,
        name: player.name,
        isAI: player.isAI,
        role: player.role?.name || null,
        roleState: player.role ? player.role.toJSON() : {},
        isAlive: player.isAlive,
        isOnline: player.isOnline,
        canVote: player.canVote
      });
    });

    return {
      roomId: this.roomId,
      hostId: this.hostId,
      state: this.state,
      currentPhase: this.currentPhase,
      dayNumber: this.dayNumber,
      lastGuarded: this.lastGuarded,
      deadTonight: this.deadTonight,
      pendingHunterShot: this.pendingHunterShot,
      speakingOrder: this.speakingOrder || null,
      currentSpeakerId: this.currentSpeakerId || null,
      currentSpeakerIndex: this.currentSpeakerIndex || 0,
      nightActions: this.nightActions,
      votes: this.votes,
      messages: this.messages,
      wolfChatHistory: this.wolfChatHistory || [],
      players: playersData,
      isPaused: this.isPaused || false,
      lastActivityTime: Date.now(),
      createdAt: this.createdAt || Date.now()
    };
  }

  // 从保存的状态恢复
  restoreState(savedState) {
    this.state = savedState.state;
    this.currentPhase = savedState.currentPhase;
    this.dayNumber = savedState.dayNumber;
    this.lastGuarded = savedState.lastGuarded;
    this.deadTonight = savedState.deadTonight || null;
    this.pendingHunterShot = savedState.pendingHunterShot || null;
    this.speakingOrder = savedState.speakingOrder || null;
    this.currentSpeakerId = savedState.currentSpeakerId || null;
    this.currentSpeakerIndex = savedState.currentSpeakerIndex || 0;
    this.nightActions = savedState.nightActions || {};
    this.votes = savedState.votes || {};
    this.messages = savedState.messages || [];
    this.wolfChatHistory = savedState.wolfChatHistory || [];
    this.isPaused = savedState.isPaused || false;
    this.lastActivityTime = savedState.lastActivityTime || Date.now();
    this.createdAt = savedState.createdAt || Date.now();
  }

  // 恢复游戏循环（服务器重启后或玩家重连后调用）
  async resumeGameLoop() {
    // 递增 session ID，使旧循环失效
    this.loopSessionId++;
    const mySessionId = this.loopSessionId;

    // 防止重复运行（但允许取代旧的循环）
    if (this.state !== 'playing' || this.isPaused) return;

    console.log(`[Resume] 恢复游戏循环，阶段: ${this.currentPhase}, 当前发言者: ${this.currentSpeakerId}, session: ${mySessionId}`);

    // 如果在白天发言阶段且有当前发言者
    if (this.currentPhase === 'day' && this.currentSpeakerId && this.speakingOrder) {
      const currentSpeakerIndex = this.speakingOrder.indexOf(this.currentSpeakerId);
      if (currentSpeakerIndex !== -1) {
        // 从当前发言者继续（不跳过，让他完成发言）
        await this.continueSpeakingFrom(currentSpeakerIndex, mySessionId);
      }
    } else if (this.currentPhase === 'vote') {
      // 如果是投票阶段，等待人类投票或处理 AI 投票
      this.processAIVotes();
    } else if (this.currentPhase === 'night') {
      // 如果是夜晚阶段，等待人类行动或处理 AI 行动
      await this.processRemainingNightActions();
    }
  }

  // 从指定索引继续发言
  async continueSpeakingFrom(startIndex, sessionId = null) {
    // 如果提供了 sessionId，用于检查循环是否被取代
    const checkSession = () => sessionId === null || sessionId === this.loopSessionId;

    if (!this.speakingOrder || startIndex >= this.speakingOrder.length) {
      // 发言已结束，进入投票
      if (!checkSession()) return; // 循环已失效
      this.addMessage('system', `📢 发言结束，即将开始投票`);
      this.manager.broadcast(this, {
        type: 'chat',
        data: { from: 'system', message: '📢 发言结束，即将开始投票' }
      });
      this.currentSpeakerId = null;
      this.currentSpeakerIndex = 0;
      await this.sleep(1000);
      if (!checkSession()) return; // 循环已失效
      this.startVote();
      return;
    }

    for (let i = startIndex; i < this.speakingOrder.length; i++) {
      // 检查循环是否被取代或游戏已结束
      if (!checkSession() || this.state === 'ended') {
        console.log(`[Speaking] 循环被取代或游戏结束，停止发言 (session: ${sessionId} vs ${this.loopSessionId}, state: ${this.state})`);
        return;
      }

      const playerId = this.speakingOrder[i];
      const player = this.players.get(playerId);
      if (!player || !player.isAlive) continue;

      this.currentSpeakerId = playerId;
      this.currentSpeakerIndex = i + 1;

      // 广播轮到谁发言
      this.manager.broadcast(this, {
        type: 'speaking_turn',
        data: {
          playerId: playerId,
          playerName: player.name,
          index: this.currentSpeakerIndex,
          isHuman: !player.isAI,
          total: this.speakingOrder.length,
          timeout: !player.isAI ? 120 : 0
        }
      });

      console.log(`[Speaking] 轮到 ${player.name}, isAI: ${player.isAI}, hasLLM: ${!!player.llmPlayer}, isAlive: ${player.isAlive}`);

      if (player.isAI && player.llmPlayer && player.isAlive) {
        try {
          console.log(`[Speaking] AI ${player.name} 开始发言...`);
          await this.sleep(800);
          if (!checkSession()) return;

          const { gameState } = this.getGameStateForAI(playerId);
          gameState.speakingCount = this.currentSpeakerIndex;
          gameState.totalPlayers = this.speakingOrder.length;
          const speechData = await player.llmPlayer.speak(gameState);
          if (!checkSession()) return;
          console.log(`[Speaking] AI ${player.name} 发言结果:`, speechData);

          // 支持 message (单条) 或 messages (多条) 格式
          const messages = speechData?.messages || (speechData?.message ? [speechData.message] : []);
          for (const msg of messages) {
            if (msg) {
              if (!checkSession()) return;
              this.addMessage(player.name, msg);
              this.manager.broadcast(this, {
                type: 'chat',
                data: { from: player.name, message: msg }
              });
              await this.sleep(4000 + Math.random() * 2000);
              if (!checkSession()) return;
            }
          }
          await this.sleep(1500);
          if (!checkSession()) return;
        } catch (err) {
          console.error(`AI ${player.name} 发言失败:`, err);
        }
      } else if (!player.isAI) {
        // 等待人类玩家发言
        const timeout = 120 * 1000;
        await this.waitForHumanSpeak(playerId, timeout);
        if (!checkSession()) return;
      }
    }

    // 发言结束
    if (!checkSession()) return;
    this.addMessage('system', `📢 发言结束，即将开始投票`);
    this.manager.broadcast(this, {
      type: 'chat',
      data: { from: 'system', message: '📢 发言结束，即将开始投票' }
    });
    this.currentSpeakerId = null;
    this.currentSpeakerIndex = 0;
    await this.sleep(1000);
    if (!checkSession()) return;
    this.startVote();
  }

  // 处理剩余的夜晚行动
  async processRemainingNightActions() {
    // 检查是否所有需要行动的玩家都已行动
    const aliveSpecialRoles = this.getAlivePlayers().filter(
      ([id, p]) => p.role && ['狼人', '预言家', '女巫', '守卫'].includes(p.role.name) && p.isAI
    );

    for (const [playerId, player] of aliveSpecialRoles) {
      if (!this.nightActions[playerId] && player.isAI && player.llmPlayer) {
        // AI 玩家未行动，触发行动
        await this.handleAINightAction(playerId);
      }
    }

    // 检查是否所有行动完成
    this.checkNightComplete();
  }

  // 暂停游戏
  pauseGame() {
    if (this.state !== 'playing') return false;

    this.isPaused = true;

    // 清除所有计时器
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.manager.broadcast(this, {
      type: 'game_paused',
      data: { pausedAt: Date.now() }
    });

    this.manager.saveData();
    return true;
  }

  // 恢复游戏
  resumeGame() {
    if (!this.isPaused) return false;

    this.isPaused = false;

    this.manager.broadcast(this, {
      type: 'game_resumed',
      data: { resumedAt: Date.now() }
    });

    this.manager.saveData();
    return true;
  }

  // 更新最后活动时间
  updateActivity() {
    this.lastActivityTime = Date.now();
  }
}
