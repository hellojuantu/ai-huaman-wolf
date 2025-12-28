import { Role } from './Role.js';

export class Guard extends Role {
  static roleName = '守卫';

  get description() {
    return '每晚可以守护一名玩家（包括自己），使其不被狼人杀死。不能连续两晚守护同一人。';
  }

  get team() {
    return 'god';
  }

  getPossibleTargets() {
    // 可以守护任何存活的玩家，但不能和上一晚相同
    return this.game
      .getAlivePlayers()
      .filter(([id]) => id !== this.game.lastGuarded)
      .map(([id, p]) => ({ id, name: p.name }));
  }

  onAction(action, target) {
    if (action === 'guard' && target) {
      const targetPlayer = this.game.players.get(target);
      if (targetPlayer) {
        return {
          success: true,
          message: `你守护了 ${targetPlayer.name}`
        };
      }
    } else if (action === 'none') {
      return { success: true, message: '你选择了空守' };
    }
    return null;
  }
}
