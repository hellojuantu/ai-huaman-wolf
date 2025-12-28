export class Role {
  static roleName = '角色';

  constructor(playerId, game) {
    this.playerId = playerId;
    this.game = game;
  }

  get name() {
    return this.constructor.roleName;
  }

  get description() {
    return '基础角色';
  }

  get team() {
    return 'villager'; // villager, wolf, god
  }

  // 夜晚可选目标
  getPossibleTargets() {
    return [];
  }

  // 行动处理
  onAction(action, target) {
    return null;
  }

  // 死亡触发
  onDeath(cause) {
    // 默认无特殊处理
  }

  // 序列化
  toJSON() {
    return {};
  }

  // 恢复
  restoreState(data) {
    // 默认无状态
  }
}
