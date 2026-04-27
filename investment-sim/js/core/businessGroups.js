/*
  businessGroups.js
  业务组系统核心模块
  - 支持创建业务组、团队管理（最多5人）、产品研发、市场扩展、专利申请、人才培养
  - 按钮式即时操作（研发/扩展/专利/培养），非月度资金分配
  - 创建时自动生成一个在研产品，每月自动推进20%进度
  - 月度仅扣除员工工资和进行中的研发/扩展花费
*/

// 行业到项目名称的映射（与 startup-projects.json 对齐）
const INDUSTRY_PROJECT_NAMES = {
  finance: ['财富管家', '链付通', '微贷宝', '快赔保', '汇通天下', '数币钱包', '票交汇', '链融通', '风控天眼', '合规大师', '财富云', '众投网', '信用宝典', '资产定价师', '极速交易', '数据猎人', '合约宝', '去中心化借贷', '金融智库', '风险雷达'],
  realestate: ['智慧物业管家', '房产估价师', '长租公寓', '商业运营通', '联合办公', '地产众筹', '装修速配', '存量房交易', '城市更新', '物流园', '养老社区', '文旅综合体', '工业改造', '数据中心', '智能停车', '建材电商', '空间设计师', '租后服务', '投后管家', '零碳建筑'],
  tech: ['搜索大师', '推荐引擎', '云端OS', '数据大脑', '智能框架', '物联中枢', '边缘节点', '链网底层', '安全卫士', '语音助手', '视觉识别', '知识库', '语言处理', '翻译官', '自动驾驶', '虚拟世界', '增强现实', '游戏引擎', '快建平台', '开发者之家'],
  semiconductor: ['7nm芯片', '高端芯片', '功率器件', '存储方案', '射频模组', '传感器', 'AI加速卡', '量子芯片', '光刻配套', '晶圆产线', '封装测试', '设计工具', 'IP授权', '半导体材料', '化合物芯片', '三代半导体', '芯粒技术', '先进封装', '光子芯片', '类脑芯片'],
  consumer: ['购物商城', '社交购物', '直播购', '社区团购', '生鲜速达', '外卖平台', '零食盒子', '美妆优选', '母婴商城', '健身伴侣', '在线学堂', '知识店铺', '短视频', '音频播客', '游戏直播', '二手集市', '奢品汇', '家居优选', '宠物之家', '订阅电商'],
  medical: ['新药研发', '基因编辑', '细胞治疗', '医疗设备', '诊断试剂', '影像AI', '远程医疗', '电子病历', '手术机器人', '健康手表', '智慧医院', '药物发现', '研发服务', '疫苗平台', '生物类似药', '精准医疗', '医疗数据', '健康管理', '康复设备', '医美科技'],
  energy: ['光伏组件', '风机系统', '储能电站', '氢能燃料', '电动车平台', '充电网络', '智慧电网', '能源管理', '碳捕集', '地热开发', '潮汐发电', '小型堆', '电池管理', '固态电池', '钙钛矿电池', '虚拟电厂', '绿氢制备', '碳交易', '能源链', '能效优化'],
  aerospace: ['商业火箭', '卫星通信', '导航服务', '遥感卫星', '载人飞船', '太空旅游', '空间站', '小行星采矿', '电动飞机', '物流无人机', '飞行汽车', '超音速客机', '智能座舱', '车芯', '车联网', '新能源汽车', '动力电池', '电机控制', '轻量化材料', '智能驾驶'],
};

/** 根据行业随机获取一个产品名 */
function getRandomProductName(industry, seed = Date.now()) {
  const names = INDUSTRY_PROJECT_NAMES[industry] || INDUSTRY_PROJECT_NAMES.tech;
  const idx = (seed + names.length) % names.length;
  return names[idx];
}

export class BusinessGroupsManager {
  constructor(config = {}) {
    this.config = Object.assign({
      marketSizeWan: 1000000,
      revenueMultiplier: 6,
      levelThreshold: 100,
      baseExpand: 0.001,
      ipoValuationThresholdWan: 200000,
      maxTeamSize: 5,
      productAutoProgressPerMonth: 0.20, // 每月自动推进20%
      rdCostPerClick: 50,      // 点击研发一次花费
      expandCostPerClick: 50,  // 点击扩展一次花费
      expandShareGain: 0.005,  // 点击扩展一次提升的市占率
      employeeSalaryWan: 5,    // 每人每月工资（业务组内）
    }, config);

    this.groups = [];
    this.employees = [];
  }

  async loadFromUrls({groupsUrl = '/data/investment-sim/business-groups.json', employeesUrl = '/data/investment-sim/employees.json'} = {}){
    const gResp = await fetch(groupsUrl);
    const eResp = await fetch(employeesUrl);
    const gJson = await gResp.json();
    const eJson = await eResp.json();
    this.groups = gJson.groups || [];
    this.employees = eJson.employees || [];
  }

  getEmployeesForGroup(group){
    return this.employees.filter(e => group.teamIds && group.teamIds.includes(e.id));
  }

  /** 生成一个在研产品 */
  generateProduct(group, seed) {
    const name = getRandomProductName(group.industry, seed);
    return {
      id: `PROD-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      name,
      progress: 0, // 0~1
      completed: false,
      createdAtMonth: group.createdAt || '1990-01',
    };
  }

  /**
   * 创建业务组时调用，自动生成初始在研产品
   */
  initGroupWithProduct(group) {
    if (!group.products) group.products = [];
    const seed = Date.now() + Math.floor(Math.random() * 10000);
    const prod = this.generateProduct(group, seed);
    group.products.push(prod);
    return group;
  }

  /**
   * 点击「研发产品」按钮
   * - 如果有未完成的在研产品，返回错误
   * - 否则生成新产品，扣除资金
   */
  startResearch(group) {
    const hasInProgress = (group.products || []).some(p => !p.completed);
    if (hasInProgress) {
      return { ok: false, error: '已有在研产品，请先完成当前研发' };
    }
    const cost = this.config.rdCostPerClick;
    if ((group.fundingWan || 0) < cost) {
      return { ok: false, error: `业务组资金不足，需要 ${cost} 万` };
    }
    group.fundingWan = (group.fundingWan || 0) - cost;
    const prod = this.generateProduct(group, Date.now());
    if (!group.products) group.products = [];
    group.products.push(prod);
    return { ok: true, product: prod, cost };
  }

  /**
   * 点击「扩展业务」按钮
   * - 消耗资金，直接提升 marketShare
   */
  expandMarket(group) {
    const cost = this.config.expandCostPerClick;
    if ((group.fundingWan || 0) < cost) {
      return { ok: false, error: `业务组资金不足，需要 ${cost} 万` };
    }
    if ((group.metrics.marketShare || 0) >= 1) {
      return { ok: false, error: '市场占有率已达上限' };
    }
    group.fundingWan = (group.fundingWan || 0) - cost;
    const gain = this.config.expandShareGain;
    group.metrics.marketShare = Math.min(1, (group.metrics.marketShare || 0) + gain);
    return { ok: true, cost, gain };
  }

  /**
   * 点击「专利申请」按钮（占位，暂无效果）
   */
  applyPatent(group) {
    // 占位：后续实现专利效果
    return { ok: true, message: '专利申请已提交（功能开发中）' };
  }

  /**
   * 点击「人才培养」按钮（占位，暂无效果）
   */
  trainTalent(group) {
    // 占位：后续实现人才培养效果
    return { ok: true, message: '人才培养计划已启动（功能开发中）' };
  }

  /**
   * 月度 tick：自动推进在研产品进度、扣除工资、更新收入与估值
   * 不再自动扣除 rdWan/expandWan/patentWan（改为按钮即时操作）
   */
  tickMonth(state = null){
    const dissolvedGroups = [];
    const remainingGroups = [];

    for(const group of this.groups){
      // 检查人员是否为0，如果是则准备裁撤
      if(!(group.teamIds||[]).length){
        dissolvedGroups.push({...group});
        if(state && state.companyCashWan !== undefined){
          state.companyCashWan = (state.companyCashWan || 0) + (group.fundingWan || 0);
        }
        continue;
      }

      const emps = this.getEmployeesForGroup(group);
      const teamSize = emps.length;

      // 1. 扣除员工工资（业务组内部发放）
      const salaryCost = teamSize * this.config.employeeSalaryWan;
      group.fundingWan = Math.max(0, (group.fundingWan || 0) - salaryCost);

      // 2. 自动推进在研产品进度（每月20%）
      const autoProgress = this.config.productAutoProgressPerMonth;
      for (const prod of (group.products || [])) {
        if (!prod.completed) {
          prod.progress = Math.min(1, (prod.progress || 0) + autoProgress);
          if (prod.progress >= 1) {
            prod.completed = true;
            prod.progress = 1;
            // 产品完成，提升 productLevel
            group.metrics.productLevel = (group.metrics.productLevel || 0) + 1;
          }
        }
      }

      // 3. 计算收入（基于 productLevel 和 marketShare）
      const productMultiplier = 1 + (group.metrics.productLevel || 0) * 0.05 + (group.metrics.patentValueWan || 0) / Math.max(1, this.config.marketSizeWan);
      const monthlyRevenueWan = this.config.marketSizeWan * (group.metrics.marketShare || 0) * productMultiplier;
      group.metrics.monthlyRevenueWan = Math.round(monthlyRevenueWan);

      // 4. 更新 TTM 收入
      group.metrics.ttmRevenueWan = (group.metrics.ttmRevenueWan || 0) * 11/12 + monthlyRevenueWan / 12;

      // 5. 收入入账（业务组资金增加）
      group.fundingWan = (group.fundingWan || 0) + monthlyRevenueWan;

      // 6. 更新估值
      group.metrics.valuationWan = Math.round(this.config.revenueMultiplier * group.metrics.ttmRevenueWan + (group.metrics.patentValueWan || 0));

      // 7. 盈亏与连续盈利计数
      const net = monthlyRevenueWan - salaryCost;
      if (net > 0) {
        group.consecutiveProfitMonths = (group.consecutiveProfitMonths || 0) + 1;
      } else {
        group.consecutiveProfitMonths = 0;
      }

      // 8. 资金耗尽判定
      if ((group.fundingWan || 0) <= 0) {
        group.stage = 'failed';
      }

      // 9. 状态迁移
      if (group.stage === 'formation' && (group.initialFundingWan || 0) >= 1000 && (group.teamIds||[]).length >= 1){
        group.stage = 'incubation';
      }
      if (group.stage === 'incubation' && (group.metrics.productLevel >= 2 && (group.metrics.marketShare || 0) >= 0.005)){
        group.stage = 'growth';
      }
      if (group.stage === 'growth' && ((group.metrics.marketShare || 0) >= 0.05 || (group.metrics.valuationWan || 0) >= 50000)){
        group.stage = 'mature';
      }

      remainingGroups.push(group);
    }

    this.groups = remainingGroups;
    return dissolvedGroups;
  }

  // 生成 IPO 对象
  generateIPOObject(group){
    const totalSharesWan = 10000;
    const initialPrice = (group.metrics.valuationWan || 0) / totalSharesWan;
    const stock = {
      stockId: `STKBG-${group.id.replace(/[^0-9A-Za-z]/g,'')}`,
      companyId: group.id,
      name: `${group.name} 股份有限公司`,
      symbol: group.id.replace(/BG-/,'BG'),
      totalSharesWan,
      freeFloatSharesWan: Math.round(totalSharesWan/2),
      initialPrice: Math.max(0.01, Number(initialPrice.toFixed(2))),
      listingYear: new Date().getFullYear(),
      industry: group.industry,
      playerHoldingsWan: { [group.ownerPlayerId || 'PLAYER-UNKNOWN']: Math.round((totalSharesWan/2)) }
    };
    return stock;
  }

  findGroup(id){ return this.groups.find(g=>g.id===id); }
  /**
   * 创建业务组并初始化默认字段与在研产品
   */
  createGroup(payload){
    const g = Object.assign({
      id: payload.id || `BG-${Date.now()}`,
      name: payload.name || '未命名业务组',
      industry: payload.industry || 'tech',
      ownerPlayerId: payload.ownerPlayerId || null,
      fundingWan: payload.fundingWan || (payload.initialFundingWan || 0),
      initialFundingWan: payload.initialFundingWan || payload.fundingWan || 0,
      stage: payload.stage || 'formation',
      teamIds: payload.teamIds ? payload.teamIds.slice(0, this.config.maxTeamSize) : [],
      leaderId: payload.leaderId || (payload.teamIds && payload.teamIds[0]) || null,
      metrics: Object.assign({
        productLevel: 0,
        productProgress: 0,
        products: [],
        marketShare: 0,
        patentCount: 0,
        patentValueWan: 0,
        monthlyRevenueWan: 0,
        ttmRevenueWan: 0,
        valuationWan: 0
      }, payload.metrics || {}),
      monthlyBurnWan: payload.monthlyBurnWan || this.config.employeeSalaryWan,
      monthlySpend: payload.monthlySpend || { rdWan: 0, expandWan: 0, patentWan: 0 },
      consecutiveProfitMonths: payload.consecutiveProfitMonths || 0,
      createdAt: payload.createdAt || new Date().toISOString().slice(0,7)
    }, payload);

    // 确保 teamIds 不超过上限
    if (g.teamIds.length > this.config.maxTeamSize) {
      g.teamIds = g.teamIds.slice(0, this.config.maxTeamSize);
    }

    // 自动生成初始在研产品
    this.initGroupWithProduct(g);

    this.groups.push(g);
    return g;
  }

  /**
   * 将员工添加到业务组（Manager API）
   */
  addEmployeeToGroup(groupId, empId){
    const g = this.findGroup(groupId);
    if(!g) return { ok:false, error: '找不到业务组' };
    if(!g.teamIds) g.teamIds = [];
    if((g.teamIds || []).length >= this.config.maxTeamSize) return { ok:false, error: `团队已达上限 ${this.config.maxTeamSize}` };
    const inAny = this.groups.some(grp => grp.id !== groupId && (grp.teamIds||[]).includes(empId));
    if(inAny) return { ok:false, error: '该员工已在其他业务组' };
    if(!g.teamIds.includes(empId)) g.teamIds.push(empId);
    return { ok:true };
  }
}

export default BusinessGroupsManager;
