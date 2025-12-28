import { Role } from './Role.js';

export class Witch extends Role {
  static roleName = '女巫';

  constructor(playerId, game) {
    super(playerId, game);
    this.hasAntidote = true; // 解药
    this.hasPoison = true; // 毒药
  }

  get description() {
    return '拥有一瓶解药和一瓶毒药。解药可以救活当晚被狼人杀死的人，毒药可以毒死一名玩家。每种药水只能使用一次。';
  }

  get team() {
    return 'god';
  }

  getPossibleTargets() {
    const targets = [];

    // 如果有解药且今晚有人被杀
    if (this.hasAntidote && this.game.deadTonight) {
      // 女巫第一晚之后不能自救
      const isSelfSave = this.game.deadTonight === this.playerId;
      const canSelfSave = this.game.dayNumber === 1;

      if (!isSelfSave || canSelfSave) {
        targets.push({
          action: 'save',
          id: this.game.deadTonight,
          name: '今晚的死者',
          label: `使用解药救人`
        });
      }
    }

    // 如果有毒药
    if (this.hasPoison) {
      const poisonTargets = this.game
        .getAlivePlayers()
        .filter(([id]) => id !== this.playerId)
        .map(([id, p]) => ({
          action: 'poison',
          id,
          name: p.name,
          label: `毒 ${p.name}`
        }));
      targets.push(...poisonTargets);
    }

    return targets;
  }

  onAction(action, target) {
    if (action === 'save' && this.hasAntidote) {
      // 女巫第一晚之后不能自救
      const isSelfSave = this.game.deadTonight === this.playerId;
      const canSelfSave = this.game.dayNumber === 1;

      if (isSelfSave && !canSelfSave) {
        return { success: false, message: '第一晚之后不能自救' };
      }
      // 解药会在 resolveNight 中处理
      return { success: true, message: '你使用了解药' };
    } else if (action === 'poison' && target && this.hasPoison) {
      // 毒药会在 resolveNight 中处理
      const targetPlayer = this.game.players.get(target);
      const targetName = targetPlayer ? targetPlayer.name : '未知玩家';
      return { success: true, message: `你选择毒死 ${targetName}` };
    } else if (action === 'none') {
      return { success: true, message: '你没有使用药水' };
    }
  }

  toJSON() {
    return {
      hasAntidote: this.hasAntidote,
      hasPoison: this.hasPoison
    };
  }

  restoreState(data) {
    if (data.hasAntidote !== undefined) this.hasAntidote = data.hasAntidote;
    if (data.hasPoison !== undefined) this.hasPoison = data.hasPoison;
  }
}
