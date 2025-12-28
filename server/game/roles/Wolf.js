import { Role } from './Role.js';

export class Wolf extends Role {
  static roleName = '狼人';

  get description() {
    return '每晚可以和同伴一起选择杀死一名玩家';
  }

  get team() {
    return 'wolf';
  }

  getPossibleTargets() {
    // 可以杀任何存活的非狼人玩家
    return this.game
      .getAlivePlayers()
      .filter(([id, p]) => p.role?.name !== '狼人')
      .map(([id, p]) => ({ id, name: p.name }));
  }

  onAction(action, target) {
    if ((action === 'kill' || action === 'wolf') && target) {
      const targetPlayer = this.game.players.get(target);
      return { success: true, message: `你选择了杀死 ${targetPlayer ? targetPlayer.name : target}` };
    } else if (action === 'none') {
      return { success: true, message: '你选择了放弃行动' };
    }
    return null;
  }
}
