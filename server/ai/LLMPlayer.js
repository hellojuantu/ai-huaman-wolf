export class LLMPlayer {
  constructor(playerId, name, config) {
    this.playerId = playerId;
    this.name = name;
    this.config = config;
    this.memory = []; // 记忆游戏历史
  }

  // 夜晚行动决策
  async decide(roleName, gameState) {
    const prompt = this.buildNightPrompt(roleName, gameState);
    const response = await this.callLLM(prompt);
    return this.parseResponse(response);
  }

  // 投票决策
  async vote(gameState) {
    const prompt = this.buildVotePrompt(gameState);
    const response = await this.callLLM(prompt);
    return this.parseResponse(response);
  }

  // 猎人开枪决策
  async hunterShot(targets) {
    const prompt = this.buildHunterPrompt(targets);
    const response = await this.callLLM(prompt);
    return this.parseResponse(response);
  }

  // 发言生成
  async speak(gameState) {
    const prompt = this.buildSpeakPrompt(gameState);
    const response = await this.callLLM(prompt, true); // 改为 JSON 模式
    return this.parseResponse(response);
  }

  // 狼人夜晚发言生成
  async wolfSpeak(gameState) {
    const prompt = this.buildWolfChatPrompt(gameState);
    const response = await this.callLLM(prompt, true);
    return this.parseResponse(response);
  }

  // 构建夜晚行动提示
  buildNightPrompt(roleName, gameState) {
    const isNightOne = gameState.dayNumber === 1;
    const nightOneHint = isNightOne ? '\n⚠️ 绝对禁令：现在是第一夜，游戏刚刚开始。没有任何人发过言，你没有任何关于其他人的信息（除狼人队友外）。严禁在理由中编造任何关于"白天发言"、"状态"、"带节奏"、"昨晚投票"的内容，因为这些事情尚未发生。请直接凭直觉或常规策略选择目标。' : '';

    const rolePrompts = {
      wolf: `你是狼人，今晚需要选择一个目标杀死。
你的狼人同伴是: ${gameState.myTeammates?.map((t) => t.name).join(', ') || '无'}
存活的玩家有: ${gameState.alivePlayers
          .filter((p) => !p.isMe)
          .map((p) => `${p.name}(ID:${p.id})`)
          .join(', ')}
${nightOneHint}
${gameState.messages?.length > 0 ? `最近的消息记录 (可能包含狼人频道的讨论结果):
${gameState.messages.slice(-5).map(m => `[${m.from}]: ${m.content}`).join('\n')}` : ''}

请选择一个玩家作为击杀目标。注意：如果你已经在狼人频道跟同伴达成了一致，请务必遵守约定。

返回 JSON 格式：
{"action": "kill", "target": "目标玩家ID", "reason": "选择原因"}`,

      seer: `你是预言家，今晚可以查验一名玩家的身份。
存活的玩家有: ${gameState.alivePlayers
          .filter((p) => !p.isMe)
          .map((p) => `${p.name}(ID:${p.id})`)
          .join(', ')}
${nightOneHint}

请选择一个想要查验的玩家。返回 JSON 格式：
{"action": "check", "target": "目标玩家ID", "reason": "选择原因"}`,

      witch: `你是女巫，你有解药和毒药各一瓶（每局各限用一次）。
${gameState.roleState?.hasAntidote ? (gameState.deadTonight ? `今晚有一名玩家被狼人杀死了，但你不知道他是谁。` : '今晚没有人被狼人杀死。') : '你已经使用过解药了。'}
${gameState.roleState?.hasPoison ? '你还拥有一瓶毒药。' : '你已经使用过毒药了。'}
存活的玩家有: ${gameState.alivePlayers
          .filter((p) => !p.isMe)
          .map((p) => `${p.name}(ID:${p.id})`)
          .join(', ')}
${nightOneHint}

你可以选择：
1. ${gameState.roleState?.hasAntidote && gameState.deadTonight ? '使用解药救活那名被杀的玩家 {"action": "save"}' : '不能使用解药（已用或无人被杀）'}
2. ${gameState.roleState?.hasPoison ? '使用毒药毒死一名玩家 {"action": "poison", "target": "目标玩家ID"}' : '不能使用毒药（已用）'}
3. 不使用药水 {"action": "none"}

请做出决策并返回 JSON 格式：
{"action": "save/poison/none", "target": "目标玩家ID（仅poison时需要）", "reason": "决策原因"}`,

      guard: `你是守卫，今晚可以守护一名玩家（包括自己）不被狼人杀死。
${gameState.lastGuarded ? `注意：你上一晚守护了 ${gameState.lastGuarded}，不能连续守护同一人。` : ''}
存活的玩家有: ${gameState.alivePlayers.map((p) => `${p.name}(ID:${p.id})${p.isMe ? '(你自己)' : ''}`).join(', ')}
${nightOneHint}

请选择要守护的玩家。返回 JSON 格式：
{"action": "guard", "target": "目标玩家ID", "reason": "选择原因"}`
    };

    return `你正在参与一场狼人杀游戏，现在是第 ${gameState.dayNumber} 夜。

${rolePrompts[roleName] || ''}

最近的游戏消息：
${gameState.messages
        .slice(-10)
        .map((m) => `[${m.from}]: ${m.content}`)
        .join('\n')}

请根据游戏情况做出决策，必须返回有效的 JSON 格式。`;
  }

  // 构建投票提示
  buildVotePrompt(gameState) {
    const roleHint =
      gameState.myRole === '狼人'
        ? `你是狼人，你的同伴是: ${gameState.myTeammates?.map((t) => t.name).join(', ') || '无'}。请注意保护自己和同伴。`
        : `你是${gameState.myRole}，你的目标是找出狼人并投票放逐他们。`;

    return `你正在参与一场狼人杀游戏，现在是第 ${gameState.dayNumber} 天的投票阶段。

${roleHint}

存活的玩家有: ${gameState.alivePlayers.map((p) => `${p.name}(ID:${p.id})${p.isMe ? '(你自己)' : ''}`).join(', ')}

最近的发言记录：
${gameState.messages
        .slice(-15)
        .map((m) => `[${m.from}]: ${m.content}`)
        .join('\n')}

请分析各玩家的发言，选择一个你认为最可疑的玩家投票放逐。
请务必确保 "target" 字段使用的是列表中精确的 ID（如 "p1", "p2" 等），不要仅凭名字猜测。
返回 JSON 格式：{"target": "目标玩家ID", "reason": "投票原因"}`;
  }

  // 构建猎人开枪提示
  buildHunterPrompt(targets) {
    return `你是猎人，你已经死亡了！现在你可以开枪带走一名玩家。

可选的目标有: ${targets.map((t) => `${t.name}(ID:${t.id})`).join(', ')}

请选择你要射杀的目标。
请务必确保 "target" 字段使用的是列表中精确的 ID（如 "p1", "p2" 等），不要仅凭名字猜测。
返回 JSON 格式：
{"target": "目标玩家ID", "reason": "选择原因"}`;
  }

  // 构建发言提示
  buildSpeakPrompt(gameState) {
    const roleHint =
      gameState.myRole === '狼人'
        ? '你是狼人阵营，需要隐藏身份，伪装成好人，引导投票放逐其他玩家。'
        : `你是${gameState.myRole}（好人阵营），需要找出狼人并投票放逐他们。`;

    // 发言顺序展示
    const currentPos = gameState.speakingOrder?.findIndex(p => p.isMe) + 1 || 0;
    const orderSequence = gameState.speakingOrder?.map((p, i) => `${i + 1}. ${p.name}${p.isMe ? '(你自己)' : ''}`).join(' -> ') || '未知';

    return `【狼人杀游戏 - 第 ${gameState.dayNumber || 1} 天白天讨论】

【你的身份】
- 名字：${this.name}
- 角色：${gameState.myRole}
- ${roleHint}

【发言顺序】
- 完整顺序：${orderSequence}
- 你当前处于：第 ${currentPos} 位发言

【场上存活玩家】
- ${gameState.alivePlayers.map((p) => p.name).join(', ')}

【发言记录】
${gameState.messages
        .slice(-15)
        .map((m) => `[${m.from}]: ${m.content}`)
        .join('\n') || '(暂无发言)'
      }

【发言要求】
1. 发言是按顺序进行的，你是第 ${currentPos} 位。请仔细分析前面几位玩家的发言内容，并进行有针对性的回应。
2. 以"${this.name}"的第一人称发言，不要使用"${this.name}说"这种形式。
3. 自然、有逻辑地表达观点。可以质疑发言矛盾的人，或者支持逻辑一致的人。
4. **为了模拟真实人类，你可以将发言拆分为 1 到 3 条消息发送。** 请不要在消息中包含任何名字前导（不要在内容里写 "小明: ..."）。

请返回 JSON 格式：
{
    "messages": [
        "第一条消息内容",
        "第二条消息内容（可选）",
        "第三条消息内容（可选）"
    ]
}`;
  }

  // 构建狼人夜晚交流提示
  buildWolfChatPrompt(gameState) {
    // 获取同伴
    const teammates = gameState.myTeammates?.map((t) => t.name).join(', ') || '无';

    // 交流记录
    const chatHistory =
      gameState.messages
        .slice(-8)
        .map((m) => `${m.from}: ${m.content}`)
        .join('\n') || '(暂无交流)';

    return `【狼人杀游戏 - 第 ${gameState.dayNumber} 夜 - 狼人频道】

【你的身份】
- 名字：${this.name}
- 角色：狼人
- 你的同伴：${teammates}

【当前阶段】
- 现在是夜晚，你正在与同伴（狼人）进行私密交流。
- 只有狼人能看到这些消息。
- 你们需要商量今晚杀死谁。
- 你们需要商量今晚杀死谁。
- ${gameState.dayNumber === 1 ? '这是第一夜，没有任何信息。不要编造理由（如"白天他跳得欢"等），请随机选择一个幸运儿或者凭直觉杀人。注意：严禁提到"白天"的任何事情，因为还没有天亮过。' : '建议：提出击杀目标，或者回应同伴的提议。分析白天的情况，找出对狼人威胁最大的好人（如预言家、女巫）。'}
【存活好人名单】
${gameState.alivePlayers
        .filter((p) => p.role !== '狼人') // 简单过滤，实际 gameState.alivePlayers 可能包含 role 字段
        .map((p) => `- ${p.name}`)
        .join('\n')}

【交流记录】
${chatHistory}

【发言要求】
1. 直接输入你（${this.name}）想说的话。
2. 讨论要简短直接，聚焦于今晚杀谁。
3. ⚠️ 拒绝复读：不要重复刚才有人说过的话，也不要重复你自己说过的话。如果已经有人提出了目标，请简短表达同意或提出不同理由。
4. ⚠️ 保持逻辑一致：${gameState.dayNumber === 1 ? '严禁提到任何关于"白天发言"、"状态"或"身份展示"的事情。' : '根据白天情况分析。'}
5. 🚫 重点提示：返回的消息内容不要包含名字前缀（例如不要回复 "${this.name}：..."）。请直接返回你想说的话。

请返回 JSON 格式：
{
    "messages": [
        "消息内容..."
    ]
}
`;
  }

  // 调用 LLM API
  async callLLM(prompt, jsonMode = true) {
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: '你是一个狼人杀游戏的 AI 玩家，请根据游戏规则和当前形势做出决策。' + (jsonMode ? '你必须返回有效的 JSON 格式响应。' : '')
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: jsonMode ? 0.3 : 0.7, // JSON模式（决策）降低随机性
          max_tokens: 500,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API 错误: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (err) {
      console.error('LLM 调用失败:', err);
      throw err;
    }
  }

  // 解析 LLM 响应
  parseResponse(responseText) {
    try {
      // 尝试解析 JSON
      const parsed = JSON.parse(responseText);
      return parsed;
    } catch (err) {
      // 如果不是有效 JSON，尝试提取
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('JSON 解析失败:', e);
        }
      }
      return null;
    }
  }

  // 添加记忆
  addMemory(event) {
    this.memory.push({
      ...event,
      timestamp: Date.now()
    });

    // 保留最近的50条记忆
    if (this.memory.length > 50) {
      this.memory = this.memory.slice(-50);
    }
  }
}
