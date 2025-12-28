import { Role } from './Role.js';

export class Villager extends Role {
  static roleName = '平民';

  get description() {
    return '普通村民，没有特殊技能，但可以投票放逐嫌疑人。';
  }

  get team() {
    return 'villager';
  }

  getPossibleTargets() {
    // 平民夜晚无行动
    return [];
  }
}
