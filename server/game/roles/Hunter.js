import { Role } from './Role.js';

export class Hunter extends Role {
  static roleName = '猎人';

  constructor(playerId, game) {
    super(playerId, game);
    this.canShoot = true; // 能否开枪（被女巫毒死则不能）
  }

  get description() {
    return '被杀死时可以开枪带走一名玩家（被毒死除外）';
  }

  get team() {
    return 'god';
  }

  getPossibleTargets() {
    // 猎人夜晚无行动
    return [];
  }

  onDeath(cause) {
    // 被毒死不能开枪
    if (cause === 'poison') {
      this.canShoot = false;
      return;
    }

    // 触发开枪
    if (this.canShoot) {
      this.game.pendingHunterShot = this.playerId;

      const player = this.game.players.get(this.playerId);
      const targets = this.game
        .getAlivePlayers()
        .filter(([id]) => id !== this.playerId)
        .map(([id, p]) => ({ id, name: p.name }));

      // 通知猎人开枪
      if (player && !player.isAI) {
        this.game.manager.sendToPlayer(this.playerId, {
          type: 'hunter_shot',
          data: {
            message: '你已死亡，请选择开枪目标',
            targets
          }
        });
      } else if (player && player.isAI && player.llmPlayer) {
        // AI 猎人自动开枪
        this.handleAIShot(targets);
      }
    }
  }

  async handleAIShot(targets) {
    try {
      const player = this.game.players.get(this.playerId);
      if (!player || !player.llmPlayer) return;

      const { reverseIdMap, idMap } = this.game.getGameStateForAI(this.playerId);

      const maskedTargets = targets.map(t => ({
        id: reverseIdMap[t.id] || t.id,
        name: t.name
      }));

      const decision = await player.llmPlayer.hunterShot(maskedTargets);
      if (decision && decision.target) {
        let finalTarget = decision.target;
        if (idMap[finalTarget]) finalTarget = idMap[finalTarget];
        this.shoot(finalTarget);
      }
    } catch (err) {
      console.error('AI 猎人开枪失败:', err);
    }
  }

  shoot(targetId) {
    const target = this.game.players.get(targetId);
    if (target && target.isAlive) {
      this.game.killPlayer(targetId, 'hunter');

      const shooter = this.game.players.get(this.playerId);
      this.game.addMessage('system', `猎人 ${shooter.name} 开枪带走了 ${target.name}`);

      this.game.manager.broadcast(this.game, {
        type: 'hunter_shot_result',
        data: {
          hunter: shooter.name,
          target: target.name,
          targetId: target.id
        }
      });
    }

    this.game.pendingHunterShot = null;
  }

  toJSON() {
    return {
      canShoot: this.canShoot
    };
  }

  restoreState(data) {
    if (data.canShoot !== undefined) this.canShoot = data.canShoot;
  }
}
