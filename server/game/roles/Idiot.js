import { Role } from './Role.js';

export class Idiot extends Role {
  static roleName = '白痴';

  constructor(playerId, game) {
    super(playerId, game);
    this.canReveal = true; // 能否翻牌（只能一次）
  }

  get description() {
    return '被投票放逐时可以翻开底牌展示身份，免于死亡，但之后失去投票权。';
  }

  get team() {
    return 'god';
  }

  getPossibleTargets() {
    // 白痴夜晚无行动
    return [];
  }

  toJSON() {
    return {
      canReveal: this.canReveal
    };
  }

  restoreState(data) {
    if (data.canReveal !== undefined) this.canReveal = data.canReveal;
  }
}
