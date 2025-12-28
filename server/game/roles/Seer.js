import { Role } from './Role.js';

export class Seer extends Role {
  static roleName = '预言家';

  get description() {
    return '每晚可以查验一名玩家的身份（好人/狼人）';
  }

  get team() {
    return 'god';
  }

  getPossibleTargets() {
    // 可以查验任何存活的其他玩家
    return this.game
      .getAlivePlayers()
      .filter(([id]) => id !== this.playerId)
      .map(([id, p]) => ({ id, name: p.name }));
  }

  onAction(action, target) {
    if ((action === 'check' || action === 'seer') && target) {
      const targetPlayer = this.game.players.get(target);
      if (targetPlayer) {
        const isWolf = targetPlayer.role?.name === '狼人';
        return {
          success: true,
          message: `${targetPlayer.name} 的身份是: ${isWolf ? '狼人' : '好人'}`,
          isWolf
        };
      }
    }
    return null;
  }
}
