import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const e2eUserData = path.join(artifacts, 'e2e-user-data');
await fs.mkdir(artifacts, { recursive: true });
await fs.rm(e2eUserData, { recursive: true, force: true });
const recoveryDirectory = path.join(e2eUserData, 'move-recovery');
const recoveryId = '11111111-1111-4111-8111-111111111111';
const recoverySource = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', '__desktop_workspace_e2e_recovery__.txt');
const recoveryTarget = path.join(artifacts, '__desktop_workspace_e2e_recovery__.txt');
await fs.mkdir(recoveryDirectory, { recursive: true });
await fs.writeFile(path.join(recoveryDirectory, `move-${recoveryId}.json`), JSON.stringify({ id: recoveryId, operationId: 'e2e', name: 'E2E 安全恢复测试', source: recoverySource, target: recoveryTarget, stage: 'prepared', holding: path.join(path.dirname(recoverySource), '.desktop-workspace-e2e-recovery.moving'), sealed: path.join(path.dirname(recoverySource), '.desktop-workspace-e2e-recovery.moving.sealed'), temporary: `${recoveryTarget}.desktop-workspace-e2e.partial`, createdAt: Date.now(), updatedAt: Date.now() }));
if (process.env.E2E_EVERYTHING_CONNECTOR) {
  const connectorDirectory = path.join(e2eUserData, 'everything-connector');
  await fs.mkdir(connectorDirectory, { recursive: true });
  await fs.copyFile(process.env.E2E_EVERYTHING_CONNECTOR, path.join(connectorDirectory, 'es.exe'));
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const executablePath = process.env.E2E_EXECUTABLE || undefined;
const electronApp = await electron.launch({
  executablePath,
  args: executablePath ? [] : [root],
  cwd: root,
  env: {
    ...process.env,
    DESKTOP_WORKSPACE_USER_DATA: e2eUserData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
});
let appExited = false;
const rendererErrors = [];
const trackedWindows = new WeakSet();
const trackRendererErrors = (window) => {
  if (trackedWindows.has(window)) return;
  trackedWindows.add(window);
  window.on('pageerror', (error) => rendererErrors.push(error.message));
};
electronApp.on('window', trackRendererErrors);

try {
  const main = await electronApp.firstWindow();
  trackRendererErrors(main);
  await main.waitForLoadState('domcontentloaded');
  await main.locator('h1').waitFor({ state: 'visible' });
  const sidebarNav = main.locator('.nav-scroll');
  await main.getByRole('dialog', { name: '整理恢复中心' }).waitFor({ state: 'visible' });
  assert(await main.getByText('E2E 安全恢复测试', { exact: true }).count() === 1, '启动时没有显示未完成的跨盘整理事务');
  await main.screenshot({ path: path.join(artifacts, 'move-recovery-dialog.png') });
  await main.getByRole('button', { name: '全部安全恢复' }).click();
  await main.getByRole('dialog', { name: '整理恢复中心' }).waitFor({ state: 'hidden' });
  assert((await main.evaluate(() => window.desktopAPI.listMoveRecoveryIssues())).length === 0, '安全恢复后事务日志没有清除');
  assert(await main.title() === '桌面工作台', '主窗口标题不正确');
  assert(await main.locator('.item-card').count() > 20, '未读取到足够的桌面项目');
  const mainZoom = main.getByRole('group', { name: '桌面工作台图标' });
  assert(await mainZoom.count() === 1, '主工作台缺少快捷缩放控件');
  await mainZoom.getByRole('button', { name: '桌面工作台图标放大' }).click();
  await main.waitForFunction(() => getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--item-scale').trim() === '1.05');
  await main.locator('.app-shell').evaluate((element) => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })));
  await main.waitForFunction(() => getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--item-scale').trim() === '1.1');
  await mainZoom.getByRole('button', { name: '桌面工作台图标恢复 100%' }).click();
  await main.waitForFunction(() => getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--item-scale').trim() === '1');
  assert(await main.getByText('公共桌面', { exact: true }).count() > 0, '公共桌面来源标签缺失');
  assert(await main.locator('.item-card').first().getAttribute('tabindex') === '0', '项目卡片不能通过键盘聚焦');
  const historyButtonBounds = await main.getByRole('button', { name: '整理记录' }).boundingBox();
  const initialViewportHeight = await main.evaluate(() => window.innerHeight);
  assert(historyButtonBounds && historyButtonBounds.y + historyButtonBounds.height <= initialViewportHeight, `侧栏底部整理记录入口不在视口内：${JSON.stringify({ historyButtonBounds, initialViewportHeight })}`);
  const shortcutIconSources = await main.locator('.item-icon.type-shortcut img').evaluateAll((images) => images.map((image) => image.getAttribute('src')).filter(Boolean));
  assert(shortcutIconSources.length > 3, '软件快捷方式图标没有加载');
  assert(new Set(shortcutIconSources).size >= Math.min(4, shortcutIconSources.length), '软件快捷方式仍在使用同一个通用图标');
  assert(await main.locator('.item-icon-initials').count() > 0, '无法提取原生图标的软件没有显示名称后备图标');
  const categoryGroups = main.locator('.workspace-category-group');
  assert(await categoryGroups.count() > 1, '全部内容没有按工作场景分组');
  const groupedItemCount = await categoryGroups.locator('.item-card').count();
  assert(groupedItemCount === await main.locator('.item-card').count(), '工作场景分组遗漏了桌面项目');
  const groupOrder = await categoryGroups.evaluateAll((groups) => groups.map((group) => group.getAttribute('data-category-id')));
  const configuredCategoryOrder = await main.evaluate(() => window.desktopAPI.getSettings().then((settings) => settings.categories.map((category) => category.id)));
  const expectedVisibleOrder = configuredCategoryOrder.filter((id) => groupOrder.includes(id));
  assert(JSON.stringify(groupOrder.filter((id) => id !== 'unassigned')) === JSON.stringify(expectedVisibleOrder), '全部内容的分组顺序与左侧工作场景不一致');
  await main.screenshot({ path: path.join(artifacts, 'workspace-grid.png') });

  const reorderCategoryId = await categoryGroups.evaluateAll((groups) => groups.find((group) => group.querySelectorAll('.item-card').length >= 2)?.getAttribute('data-category-id'));
  assert(reorderCategoryId, '没有找到可验证图标排序的工作场景分组');
  const reorderGroup = main.locator(`.workspace-category-group[data-category-id="${reorderCategoryId}"]`);
  const initialGridIds = await reorderGroup.locator('.item-card').evaluateAll((cards) => cards.slice(0, 2).map((card) => card.getAttribute('data-item-id')));
  const firstGridCard = reorderGroup.locator(`.item-card[data-item-id="${initialGridIds[0]}"]`);
  const secondGridCard = reorderGroup.locator(`.item-card[data-item-id="${initialGridIds[1]}"]`);
  const secondBounds = await secondGridCard.boundingBox();
  assert(secondBounds, '无法读取图标拖拽目标位置');
  await firstGridCard.dragTo(secondGridCard, { targetPosition: { x: secondBounds.width - 6, y: secondBounds.height / 2 } });
  try {
    await main.waitForFunction(() => document.querySelector('.select-control')?.value === 'custom', null, { timeout: 700 });
  } catch {
    await main.evaluate(({ sourceId, targetId }) => {
      const source = document.querySelector(`.item-card[data-item-id="${CSS.escape(sourceId)}"]`);
      const target = document.querySelector(`.item-card[data-item-id="${CSS.escape(targetId)}"]`);
      if (!source || !target) return;
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      const bounds = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.right - 4, clientY: bounds.top + bounds.height / 2 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.right - 4, clientY: bounds.top + bounds.height / 2 }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    }, { sourceId: initialGridIds[0], targetId: initialGridIds[1] });
    await main.waitForFunction(() => document.querySelector('.select-control')?.value === 'custom');
  }
  await main.locator('.select-control').waitFor({ state: 'visible' });
  assert(await main.locator('.select-control').inputValue() === 'custom', '图标相互拖拽后没有切换到自定义顺序');
  const reorderedGridIds = await reorderGroup.locator('.item-card').evaluateAll((cards) => cards.slice(0, 2).map((card) => card.getAttribute('data-item-id')));
  assert(reorderedGridIds[0] === initialGridIds[1] && reorderedGridIds[1] === initialGridIds[0], '图标相互拖拽后顺序没有保存');
  await main.screenshot({ path: path.join(artifacts, 'workspace-reordered.png') });
  await sidebarNav.getByRole('button', { name: /AI 与开发/ }).click();
  assert(await main.locator('.item-icon-initials').count() > 0, 'AI 与开发页面没有显示缺失图标的后备标识');
  await main.screenshot({ path: path.join(artifacts, 'workspace-fallback-icons.png') });
  await sidebarNav.getByRole('button', { name: /全部内容/ }).click();

  const personalCard = main.locator('.item-card[aria-label$="，个人桌面"]').first();
  assert(await personalCard.count() === 1, '没有找到可用于安全整理测试的个人桌面项目');
  const personalId = await personalCard.getAttribute('data-item-id');
  const compactCardBounds = await personalCard.boundingBox();
  const compactIconBounds = await personalCard.locator('.item-icon').boundingBox();
  assert(compactCardBounds && compactCardBounds.height <= 150, `网格项目仍然过高：${JSON.stringify(compactCardBounds)}`);
  assert(compactIconBounds && compactIconBounds.width <= 42 && compactIconBounds.height <= 42, `网格图标仍然过大：${JSON.stringify(compactIconBounds)}`);
  assert(await personalCard.locator('.item-main span').evaluate((element) => getComputedStyle(element).display === 'none'), '紧凑网格仍然显示分类副标题');
  await personalCard.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(await main.locator('.details-pane').count() === 0, '单击项目不应自动打开详情面板');
  await personalCard.hover();
  assert(await personalCard.locator('.item-actions button').count() === 4, '项目快捷操作栏没有新增详情按钮');
  assert(await personalCard.locator('.item-actions').isVisible(), '鼠标悬停后项目快捷操作栏没有显示');
  const itemNameBounds = await personalCard.locator('.item-main').boundingBox();
  const actionBarBounds = await personalCard.locator('.item-actions').boundingBox();
  assert(itemNameBounds && actionBarBounds && actionBarBounds.y >= itemNameBounds.y, '快捷操作栏没有位于图标名称下方');
  await main.screenshot({ path: path.join(artifacts, 'workspace-detail-action.png') });
  await personalCard.getByTitle('查看详情').click();
  await main.getByText('项目详情', { exact: true }).waitFor({ state: 'visible' });
  assert(await main.locator('.details-pane').count() === 1, '详情图标没有打开右侧详情面板');
  await main.getByTitle('关闭详情', { exact: true }).click();
  await electronApp.evaluate(({ shell }) => {
    global.__desktopWorkspaceOpenCalls = 0;
    shell.openPath = async () => {
      global.__desktopWorkspaceOpenCalls += 1;
      return '';
    };
  });
  await personalCard.dblclick();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const doubleClickOpenCalls = await electronApp.evaluate(() => global.__desktopWorkspaceOpenCalls || 0);
  assert(doubleClickOpenCalls === 1, '双击项目没有调用打开功能');
  await personalCard.locator('.star-button').click();
  await personalCard.locator('.star-button.active').waitFor({ state: 'visible' });
  await personalCard.locator('.check-button').click();
  await main.getByRole('button', { name: /整理到桌面归档/ }).click();
  await main.getByText('整理预览', { exact: true }).waitFor({ state: 'visible' });
  await main.locator('.preview-row:not(.failed)').first().waitFor({ state: 'visible' });
  assert(await main.locator('.preview-row:not(.failed)').count() > 0, '个人桌面项目没有生成整理预览');
  await main.keyboard.press('Escape');
  await main.getByText('整理预览', { exact: true }).waitFor({ state: 'hidden' });
  await main.locator('.selection-bar select').selectOption('papers');
  await main.locator('.selection-bar').waitFor({ state: 'hidden' });
  const stablePersonalCard = main.locator(`.item-card[data-item-id="${personalId}"]`);
  assert(await stablePersonalCard.getByText('论文与资料', { exact: true }).count() > 0, '虚拟分类没有更新');

  await stablePersonalCard.click({ button: 'right' });
  await main.locator('.context-menu').waitFor({ state: 'visible' });
  await main.screenshot({ path: path.join(artifacts, 'workspace-context-menu.png') });
  await main.getByRole('menuitemradio', { name: '工程工具' }).click();
  await stablePersonalCard.getByText('工程工具', { exact: true }).waitFor({ state: 'attached' });

  await stablePersonalCard.dragTo(sidebarNav.getByRole('button', { name: /论文与资料/ }));
  await stablePersonalCard.getByText('论文与资料', { exact: true }).waitFor({ state: 'attached' });
  await stablePersonalCard.locator('.star-button').click();
  await stablePersonalCard.locator('.star-button:not(.active)').waitFor({ state: 'visible' });
  await stablePersonalCard.dragTo(sidebarNav.getByRole('button', { name: /收藏项目/ }));
  await stablePersonalCard.locator('.star-button.active').waitFor({ state: 'visible' });

  await main.keyboard.press('Control+f');
  assert(await main.locator('.search-box input').evaluate((input) => document.activeElement === input), 'Ctrl+F 没有聚焦搜索框');
  await main.locator('h1').click();
  await main.keyboard.press('Control+a');
  await main.locator('.selection-bar').waitFor({ state: 'visible' });
  assert(await main.locator('.item-card.selected').count() === await main.locator('.item-card').count(), 'Ctrl+A 没有选择当前全部结果');
  await main.keyboard.press('Escape');
  await main.locator('.selection-bar').waitFor({ state: 'hidden' });
  await main.locator('.select-visible input').check();
  await main.locator('.selection-bar').waitFor({ state: 'visible' });
  await main.locator('.select-visible input').uncheck();
  await main.locator('.selection-bar').waitFor({ state: 'hidden' });

  await main.getByRole('button', { name: '数据安全中心' }).click();
  await main.getByPlaceholder('快照名称（可选）').fill('E2E 快照');
  await main.getByRole('button', { name: '创建当前快照' }).click();
  await main.getByText('E2E 快照', { exact: true }).waitFor({ state: 'visible' });
  await main.getByLabel('关闭数据安全中心').click();

  await main.getByTitle('列表视图').click();
  await main.locator('.item-row').first().waitFor({ state: 'visible' });
  assert(await main.locator('.item-row').count() > 20, '列表视图项目数量异常');
  await main.locator('.search-box input').fill('微信');
  assert(await main.locator('.item-row').count() > 0, '搜索没有返回微信相关项目');
  await main.locator('.search-box input').fill('');

  const rowToHide = main.locator(`.item-row[data-item-id="${personalId}"]`);
  await rowToHide.getByTitle('隐藏').click();
  await sidebarNav.getByRole('button', { name: /已隐藏/ }).click();
  const hiddenRow = main.locator(`.item-row[data-item-id="${personalId}"]`);
  await hiddenRow.waitFor({ state: 'visible' });
  await hiddenRow.getByTitle('隐藏').click();
  await sidebarNav.getByRole('button', { name: /全部内容/ }).click();

  await main.getByTitle('设置').click();
  await main.getByText('快速面板热键', { exact: true }).waitFor({ state: 'visible' });
  assert(await main.locator('.settings-form').count() === 1, '设置对话框未打开');
  await main.keyboard.press('Shift+Tab');
  assert(await main.locator('.modal').evaluate((modal) => modal.contains(document.activeElement)), '弹窗焦点逃离到背景界面');
  await main.getByRole('checkbox', { name: /减少动态效果/ }).check();
  await main.getByRole('button', { name: '保存设置' }).click();
  await main.locator('.settings-form').waitFor({ state: 'hidden' });
  assert(await main.locator('html').getAttribute('data-reduce-motion') === 'true', '减少动态效果设置没有生效');

  await main.getByRole('button', { name: 'Everything 搜索' }).click();
  await main.getByRole('heading', { name: 'Everything 搜索' }).waitFor({ state: 'visible' });
  await main.getByRole('button', { name: '配置说明' }).click();
  await main.getByRole('dialog', { name: 'Everything 配置说明' }).waitFor({ state: 'visible' });
  const guideImageState = await main.getByRole('img', { name: 'Everything 快捷方式属性和安装目录选择示意图' }).evaluate((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }));
  assert(guideImageState.complete && guideImageState.naturalWidth > 1000 && guideImageState.naturalHeight > 600, `Everything 配置示意图没有正确加载：${JSON.stringify(guideImageState)}`);
  assert(await main.locator('.everything-guide-step').count() === 4, 'Everything 配置说明没有显示完整的四个步骤');
  await main.screenshot({ path: path.join(artifacts, 'everything-configuration-guide.png') });
  await main.getByRole('button', { name: '我知道了' }).click();
  await main.getByRole('dialog', { name: 'Everything 配置说明' }).waitFor({ state: 'hidden' });
  if (process.env.E2E_INSTALL_EVERYTHING_CONNECTOR) {
    await main.getByRole('button', { name: '完成连接' }).click();
    await main.getByText(/已连接/).waitFor({ state: 'visible', timeout: 30000 });
  }
  if (process.env.E2E_EVERYTHING_CONNECTOR || process.env.E2E_INSTALL_EVERYTHING_CONNECTOR) {
    const everythingInput = main.getByLabel('Everything 搜索');
    await everythingInput.waitFor({ state: 'visible' });
    await main.screenshot({ path: path.join(artifacts, 'everything-status.png') });
    const everythingStatus = await main.evaluate(() => window.desktopAPI.getEverythingStatus());
    assert(!(await everythingInput.isDisabled()), `Everything 已配置但搜索框不可用：${JSON.stringify(everythingStatus)} ${await main.locator('.everything-page').innerText()}`);
    await everythingInput.fill('Everything.exe');
    await main.locator('.everything-result').first().waitFor({ state: 'visible', timeout: 20000 });
    assert(await main.locator('.everything-result').count() > 0, 'Everything 没有返回搜索结果');
    await main.screenshot({ path: path.join(artifacts, 'everything-search.png') });
  } else {
    assert(await main.locator('.everything-setup').count() === 1, 'Everything 未配置时没有显示连接设置');
  }
  await sidebarNav.getByRole('button', { name: /全部内容/ }).click();

  await main.getByTitle('管理工作场景').click();
  const categoryInputs = main.getByLabel('分类名称');
  const categoryNames = await categoryInputs.evaluateAll((inputs) => inputs.map((input) => input.value));
  const categoryRows = main.locator('.category-edit-row');
  const inboxRow = categoryRows.nth(categoryNames.indexOf('待整理'));
  assert(await inboxRow.getByTitle('基础分类不可删除').isDisabled(), '待整理基础分类不应允许删除');
  const creativeRow = categoryRows.nth(categoryNames.indexOf('创作与媒体'));
  assert(!(await creativeRow.getByTitle(/删除分类/).isDisabled()), '预设工作场景应允许删除');
  main.once('dialog', (dialog) => dialog.accept());
  await creativeRow.getByTitle(/删除分类/).click();
  const officeCategoryInput = categoryInputs.nth(categoryNames.indexOf('办公与沟通'));
  await officeCategoryInput.fill('办公');
  await officeCategoryInput.pressSequentially('协作');
  assert(await officeCategoryInput.evaluate((input) => document.activeElement === input), '分类名称逐字输入后丢失焦点');
  const firstCategoryName = main.getByLabel('分类名称').first();
  const originalCategoryName = await firstCategoryName.inputValue();
  await firstCategoryName.fill('');
  await main.getByRole('button', { name: '保存分类' }).click();
  await main.getByRole('alert').waitFor({ state: 'visible' });
  await firstCategoryName.fill(originalCategoryName);
  await main.getByRole('button', { name: '新增分类' }).click();
  await main.getByLabel('分类名称').last().fill('临时测试分类');
  await main.getByTitle('配置一键启动').last().click();
  await main.getByRole('button', { name: '项目', exact: true }).click();
  await main.getByRole('button', { name: '完成编辑' }).click();
  await main.getByTitle('显示在快速面板').last().click();
  await main.getByRole('button', { name: '保存分类' }).click();
  await sidebarNav.getByRole('button', { name: /临时测试分类/ }).waitFor({ state: 'visible' });
  await sidebarNav.getByRole('button', { name: /办公协作/ }).waitFor({ state: 'visible' });
  assert(await sidebarNav.getByRole('button', { name: /创作与媒体/ }).count() === 0, '删除的预设工作场景仍显示在侧栏');
  const openCallsBeforeScene = await electronApp.evaluate(() => global.__desktopWorkspaceOpenCalls || 0);
  await sidebarNav.getByRole('button', { name: /临时测试分类/ }).click();
  await main.getByRole('button', { name: '启动工作场景' }).click();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert(await electronApp.evaluate(() => global.__desktopWorkspaceOpenCalls || 0) > openCallsBeforeScene, '工作场景没有按步骤启动项目');

  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.isAlwaysOnTop())?.webContents.send('ui:open-settings'));
  await main.locator('.settings-form').waitFor({ state: 'visible' });
  assert(await main.getByRole('slider', { name: '桌面工作台图标大小' }).count() === 1, '设置中缺少桌面工作台图标缩放');
  assert(await main.getByRole('slider', { name: '快速面板图标大小' }).count() === 1, '设置中缺少快速面板图标缩放');
  assert(await main.getByRole('group', { name: '快速面板停靠位置' }).count() === 1, '设置中缺少快速面板停靠位置');
  assert(await main.getByRole('slider', { name: '自动隐藏延时' }).count() === 1, '设置中缺少自动隐藏延时');
  assert(await main.getByRole('slider', { name: '边缘触发区域' }).count() === 1, '设置中缺少边缘触发区域');
  assert(await main.getByRole('slider', { name: '边缘吸附距离' }).count() === 1, '设置中缺少边缘吸附距离');
  assert(await main.getByRole('slider', { name: '快速面板滑出速度' }).count() === 1, '设置中缺少滑出速度');
  await main.getByRole('slider', { name: '桌面工作台图标大小' }).fill('135');
  await main.getByRole('slider', { name: '快速面板图标大小' }).fill('125');
  await main.screenshot({ path: path.join(artifacts, 'settings-quick-panel.png') });
  await main.getByRole('button', { name: '保存设置' }).click();
  await main.locator('.settings-form').waitFor({ state: 'hidden' });
  assert(await main.locator('.app-shell').evaluate((element) => getComputedStyle(element).getPropertyValue('--item-scale').trim()) === '1.35', '桌面工作台图标缩放没有实时应用');
  await sidebarNav.getByRole('button', { name: /全部内容/ }).click();
  await main.locator('.items .item-icon').first().waitFor({ state: 'visible' });
  assert(await main.locator('.items .item-icon').first().evaluate((element) => element.getBoundingClientRect().width) > 45, '桌面工作台图标像素尺寸没有随设置放大');
  await main.getByTitle('网格视图').click();
  await main.locator('.item-card').first().waitFor({ state: 'visible' });
  assert(await main.locator('.item-icon.type-folder svg').first().evaluate((element) => element.getBoundingClientRect().width) > 30, '文件夹后备图标没有随工作台设置放大');
  const scaledCardLayout = await main.locator('.item-card').first().evaluate((card) => {
    const icon = card.querySelector('.item-icon')?.getBoundingClientRect();
    const name = card.querySelector('.item-main')?.getBoundingClientRect();
    const actions = card.querySelector('.item-actions')?.getBoundingClientRect();
    return { iconBottom: icon?.bottom || 0, nameTop: name?.top || 0, nameBottom: name?.bottom || 0, actionsTop: actions?.top || 0 };
  });
  assert(scaledCardLayout.iconBottom <= scaledCardLayout.nameTop + 1 && scaledCardLayout.nameBottom <= scaledCardLayout.actionsTop, `放大后的工作台图标、名称或快捷栏发生重叠：${JSON.stringify(scaledCardLayout)}`);
  await main.screenshot({ path: path.join(artifacts, 'workspace-scaled.png') });
  await main.getByTitle('列表视图').click();
  await main.locator('.item-row').first().waitFor({ state: 'visible' });

  await main.getByRole('button', { name: '快速面板' }).click();
  let dock = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const windows = electronApp.windows();
    dock = windows.find((window) => window.url().includes('#/dock')) || null;
    if (dock) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(dock, '快速面板窗口未创建');
  await dock.locator('.dock-shell').waitFor({ state: 'visible' });
  assert(await dock.locator('.dock-shell').evaluate((element) => getComputedStyle(element).getPropertyValue('--item-scale').trim()) === '1.25', '快速面板图标缩放没有应用');
  assert(await dock.locator('.dock-item .item-icon').first().evaluate((element) => element.getBoundingClientRect().width) > 42, '快速面板图标像素尺寸没有随设置放大');
  assert(await dock.locator('.dock-item').count() > 0, '快速面板没有常用项目');
  const dockZoom = dock.getByRole('group', { name: '快速面板图标' });
  assert(await dockZoom.count() === 1, '快速面板缺少快捷缩放控件');
  await dockZoom.getByRole('button', { name: '快速面板图标恢复 100%' }).click();
  await dock.waitForFunction(() => getComputedStyle(document.querySelector('.dock-shell')).getPropertyValue('--item-scale').trim() === '1');
  await dockZoom.getByRole('button', { name: '快速面板图标放大' }).click();
  await dock.waitForFunction(() => getComputedStyle(document.querySelector('.dock-shell')).getPropertyValue('--item-scale').trim() === '1.05');
  await dock.locator('.dock-shell').evaluate((element) => element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })));
  await dock.waitForFunction(() => getComputedStyle(document.querySelector('.dock-shell')).getPropertyValue('--item-scale').trim() === '1.1');
  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelItemScale: 125 }));
  await dock.waitForFunction(() => getComputedStyle(document.querySelector('.dock-shell')).getPropertyValue('--item-scale').trim() === '1.25');
  const expectedVisibleDockItems = await dock.evaluate(async () => (await window.desktopAPI.listDesktopItems()).items.filter((item) => !item.hidden && item.exists).length);
  assert(await dock.locator('[data-dock-item-id]').count() === expectedVisibleDockItems, '快速面板没有显示全部桌面工作台项目');
  const dockCategoryGroups = dock.locator('.dock-category-group');
  assert(await dockCategoryGroups.count() > 1, '快速面板没有按工作场景分组');
  assert(await dockCategoryGroups.locator('[data-dock-item-id]').count() === expectedVisibleDockItems, '快速面板工作场景分组遗漏了项目');
  const dockGroupOrder = await dockCategoryGroups.evaluateAll((groups) => groups.map((group) => group.getAttribute('data-dock-category-id')));
  const dockConfiguredOrder = await dock.evaluate(() => window.desktopAPI.getSettings().then((settings) => settings.categories.map((category) => category.id)));
  assert(JSON.stringify(dockGroupOrder.filter((id) => id !== 'unassigned')) === JSON.stringify(dockConfiguredOrder.filter((id) => dockGroupOrder.includes(id))), '快速面板分组顺序与左侧工作场景不一致');
  const firstDockGroup = dockCategoryGroups.first();
  const firstDockGroupId = await firstDockGroup.getAttribute('data-dock-category-id');
  const firstDockGroupCount = await firstDockGroup.locator('[data-dock-item-id]').count();
  await firstDockGroup.locator('.dock-group-header').click();
  assert(await dock.locator('.dock-category-group').count() === 1 && await dock.locator('[data-dock-item-id]').count() === firstDockGroupCount, '点击快速面板分组标题没有进入对应场景');
  assert((await dock.evaluate(() => window.desktopAPI.getSettings())).categories.some((category) => category.id === firstDockGroupId), '快速面板分组标题指向了无效场景');
  await dock.locator('.dock-category-group .dock-group-header').click();
  await dock.waitForFunction((count) => document.querySelectorAll('.dock-category-group').length === count, dockGroupOrder.length);
  assert(await dock.locator('.dock-scene').count() > 0, '快速面板没有显示已配置的一键启动场景');
  assert(await dock.locator('.dock-list.view-list').count() === 1, '快速面板默认列表排列没有生效');
  const mainHeadingBeforeDockSearch = await main.locator('main h1').textContent();
  await dock.getByRole('button', { name: /Everything 搜索/ }).click();
  await dock.locator('.dock-everything-page').waitFor({ state: 'visible' });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const everythingInputState = await dock.getByLabel('快速面板 Everything 搜索').evaluate((element) => ({ disabled: element.disabled, focused: document.activeElement === element }));
  assert(everythingInputState.disabled || everythingInputState.focused, '进入快速面板 Everything 搜索后搜索框没有获得焦点');
  assert(await main.locator('main h1').textContent() === mainHeadingBeforeDockSearch, '快速面板 Everything 搜索错误跳转到了大窗口');
  assert(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#/dock'))?.isVisible()), '进入 Everything 搜索后快速面板被隐藏');
  if (process.env.E2E_EVERYTHING_CONNECTOR || process.env.E2E_INSTALL_EVERYTHING_CONNECTOR) {
    await dock.getByLabel('快速面板 Everything 搜索').fill('Everything.exe');
    await dock.locator('.dock-everything-result').first().waitFor({ state: 'visible', timeout: 20000 });
    assert(await dock.locator('.dock-everything-result').count() > 0, '快速面板 Everything 搜索没有返回结果');
  }
  await dock.screenshot({ path: path.join(artifacts, 'quick-dock-everything.png') });
  await dock.getByRole('button', { name: '返回快速工作台' }).click();
  await dock.locator('.dock-search').waitFor({ state: 'visible' });

  const moveDockForTest = (mode) => electronApp.evaluate(({ BrowserWindow, screen }, requestedMode) => {
    const dockWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#/dock'));
    if (!dockWindow) return null;
    const displays = screen.getAllDisplays();
    const current = dockWindow.getBounds();
    let next;
    if (requestedMode === 'tear-off-top') {
      const display = screen.getDisplayMatching(current);
      next = { ...current, y: display.bounds.y + 10 };
    } else if (requestedMode === 'outer-left') {
      const display = [...displays].sort((left, right) => left.bounds.x - right.bounds.x)[0];
      next = { ...current, x: display.bounds.x + 6, y: Math.max(display.workArea.y, Math.min(display.workArea.y + display.workArea.height - current.height, display.workArea.y + 80)) };
    } else if (requestedMode === 'internal') {
      let pair = null;
      for (const left of displays) for (const right of displays) {
        const overlapStart = Math.max(left.bounds.y, right.bounds.y);
        const overlapEnd = Math.min(left.bounds.y + left.bounds.height, right.bounds.y + right.bounds.height);
        if (left.id !== right.id && Math.abs(left.bounds.x + left.bounds.width - right.bounds.x) <= 2 && overlapEnd - overlapStart >= current.height + 100) pair = { left, right, overlapStart, overlapEnd };
      }
      if (!pair) return { skipped: true };
      next = { ...current, x: pair.left.bounds.x + pair.left.bounds.width - current.width - 6, y: pair.overlapStart + 50 };
    } else {
      const display = screen.getPrimaryDisplay();
      next = { ...current, x: display.workArea.x + Math.round((display.workArea.width - current.width) / 2), y: display.workArea.y + Math.round((display.workArea.height - current.height) / 2) };
    }
    dockWindow.setBounds(next, false);
    dockWindow.emit('will-move', { preventDefault() {} }, next);
    dockWindow.emit('move');
    return { skipped: false, next };
  }, mode);
  const releaseDockForTest = () => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#/dock'))?.emit('moved'));

  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelAutoHide: true, quickPanelPinned: false, quickPanelDockPosition: 'top', quickPanelSnapDistance: 28, quickPanelSlideDuration: 180, quickPanelHideDelay: 300, quickPanelTriggerSize: 10, reduceMotion: true }));
  await dock.evaluate(() => window.desktopAPI.dockPointerEnter());
  await new Promise((resolve) => setTimeout(resolve, 120));
  await moveDockForTest('tear-off-top');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(await electronApp.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('data:text/html'))?.isVisible()), '顶部面板向下撕离后仍显示边缘吸附预览');
  await releaseDockForTest();
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert((await dock.evaluate(() => window.desktopAPI.getSettings())).quickPanelDocked === false, '顶部面板向下拖动 10px 后仍被吸回顶部');

  await moveDockForTest('outer-left');
  await new Promise((resolve) => setTimeout(resolve, 180));
  const previewState = await electronApp.evaluate(({ BrowserWindow }) => {
    const preview = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('data:text/html'));
    return { exists: Boolean(preview), visible: Boolean(preview?.isVisible()), bounds: preview?.getBounds() || null };
  });
  assert(previewState.exists && previewState.visible, `接近外部边缘时没有显示吸附预览：${JSON.stringify(previewState)}`);
  const previewPage = electronApp.windows().find((window) => window.url().startsWith('data:text/html'));
  if (previewPage) await previewPage.screenshot({ path: path.join(artifacts, 'quick-dock-snap-preview.png') });
  await releaseDockForTest();
  await new Promise((resolve) => setTimeout(resolve, 320));
  let dockSettings = await dock.evaluate(() => window.desktopAPI.getSettings());
  assert(dockSettings.quickPanelDocked && dockSettings.quickPanelDockPosition === 'left' && dockSettings.quickPanelDockDisplayId, '释放到最左侧外边缘后没有完成停靠');

  await moveDockForTest('floating');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert(await electronApp.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('data:text/html'))?.isVisible()), '远离外部边缘时仍显示吸附预览');
  await releaseDockForTest();
  await new Promise((resolve) => setTimeout(resolve, 220));
  dockSettings = await dock.evaluate(() => window.desktopAPI.getSettings());
  assert(dockSettings.quickPanelDocked === false, '拖到普通位置后快速面板没有切换为浮动状态');
  const floatingBounds = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#/dock'))?.getBounds());
  await dock.evaluate(() => window.desktopAPI.dockPointerLeave());
  await new Promise((resolve) => setTimeout(resolve, 520));
  const floatingBoundsAfterDelay = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#/dock'))?.getBounds());
  assert(JSON.stringify(floatingBounds) === JSON.stringify(floatingBoundsAfterDelay), '浮动状态下快速面板仍然自动隐藏');

  const internalMove = await moveDockForTest('internal');
  if (!internalMove?.skipped) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert(await electronApp.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().startsWith('data:text/html'))?.isVisible()), '双屏内部连接边错误显示了吸附预览');
    await releaseDockForTest();
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert((await dock.evaluate(() => window.desktopAPI.getSettings())).quickPanelDocked === false, '双屏内部连接边被错误停靠');
  }

  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelDockPosition: 'right', reduceMotion: false }));
  await new Promise((resolve) => setTimeout(resolve, 260));
  const getDockGeometry = () => electronApp.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().includes('#/dock'));
    const bounds = window?.getBounds();
    const display = bounds ? screen.getDisplayMatching(bounds) : null;
    return { bounds, workArea: display?.workArea || null, displayBounds: display?.bounds || null };
  });
  let geometry = await getDockGeometry();
  assert(geometry.bounds && geometry.displayBounds && Math.abs(geometry.bounds.x + geometry.bounds.width - geometry.displayBounds.x - geometry.displayBounds.width) <= 2, '快速面板没有停靠到右侧');
  const rightDockDisplayBounds = geometry.displayBounds;
  await main.mouse.move(500, 500);
  await dock.evaluate(() => window.desktopAPI.dockPointerLeave());
  await new Promise((resolve) => setTimeout(resolve, 620));
  geometry = await getDockGeometry();
  assert(geometry.bounds && Math.abs(geometry.bounds.x - (rightDockDisplayBounds.x + rightDockDisplayBounds.width - 10)) <= 2, `右侧触发带宽度不正确：${JSON.stringify({ geometry, rightDockDisplayBounds })}`);
  await dock.evaluate(() => window.desktopAPI.dockPointerEnter());
  await new Promise((resolve) => setTimeout(resolve, 420));
  geometry = await getDockGeometry();
  assert(geometry.bounds && geometry.displayBounds && Math.abs(geometry.bounds.x + geometry.bounds.width - geometry.displayBounds.x - geometry.displayBounds.width) <= 2, '鼠标进入触发带后快速面板没有展开');

  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelDockPosition: 'left', reduceMotion: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  geometry = await getDockGeometry();
  assert(geometry.bounds && geometry.displayBounds && Math.abs(geometry.bounds.x - geometry.displayBounds.x) <= 2, `快速面板没有停靠到左侧：${JSON.stringify(geometry)}`);
  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelDockPosition: 'top', reduceMotion: false, quickPanelHideDelay: 300, quickPanelTriggerSize: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 260));
  geometry = await getDockGeometry();
  assert(geometry.bounds && geometry.displayBounds && Math.abs(geometry.bounds.y - geometry.displayBounds.y) <= 2, `快速面板没有停靠到顶部：${JSON.stringify(geometry)}`);
  const topDockDisplayBounds = geometry.displayBounds;
  await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const dockWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('#/dock'));
    const bounds = dockWindow?.getBounds();
    global.__originalCursorScreenPoint = screen.getCursorScreenPoint.bind(screen);
    if (bounds) screen.getCursorScreenPoint = () => ({ x: bounds.x + 4, y: bounds.y + 1 });
  });
  await dock.evaluate(() => window.desktopAPI.dockPointerLeave());
  await new Promise((resolve) => setTimeout(resolve, 1000));
  geometry = await getDockGeometry();
  assert(geometry.bounds && Math.abs(geometry.bounds.y - topDockDisplayBounds.y) <= 2, '鼠标位于顶部连接处时快速面板仍然自动隐藏');
  await new Promise((resolve) => setTimeout(resolve, 420));
  geometry = await getDockGeometry();
  assert(geometry.bounds && Math.abs(geometry.bounds.y - topDockDisplayBounds.y) <= 2, '顶部连接处发生了重复展开与隐藏');
  await electronApp.evaluate(({ screen }) => {
    if (global.__originalCursorScreenPoint) screen.getCursorScreenPoint = global.__originalCursorScreenPoint;
    delete global.__originalCursorScreenPoint;
  });
  await dock.evaluate(() => window.desktopAPI.dockPointerLeave());
  await new Promise((resolve) => setTimeout(resolve, 650));
  geometry = await getDockGeometry();
  assert(geometry.bounds && Math.abs(geometry.bounds.y + geometry.bounds.height - (topDockDisplayBounds.y + 10)) <= 2, '鼠标真正移开后顶部面板没有正常收起');
  await dock.evaluate(() => window.desktopAPI.dockPointerEnter());
  await new Promise((resolve) => setTimeout(resolve, 420));
  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelDockPosition: 'right', quickPanelPinned: true }));
  await dock.evaluate(() => window.desktopAPI.dockPointerLeave());
  await new Promise((resolve) => setTimeout(resolve, 450));
  geometry = await getDockGeometry();
  assert(geometry.bounds && geometry.displayBounds && Math.abs(geometry.bounds.x + geometry.bounds.width - geometry.displayBounds.x - geometry.displayBounds.width) <= 2, '固定模式下快速面板仍然自动收起');
  await dock.evaluate(() => window.desktopAPI.updateSettings({ quickPanelPinned: false, reduceMotion: false, quickPanelHideDelay: 700, quickPanelTriggerSize: 8 }));
  await dock.evaluate(() => window.desktopAPI.dockPointerEnter());
  await new Promise((resolve) => setTimeout(resolve, 120));
  await dock.getByTitle('图标排列').click();
  await dock.locator('.dock-list.view-grid').waitFor({ state: 'visible' });
  assert(await dock.locator('.dock-item').first().locator('strong').isVisible(), '图标排列没有显示项目名称');
  assert(await dock.locator('.dock-item').first().locator('small').evaluate((element) => getComputedStyle(element).display) === 'none', '图标排列仍显示分类副标题');
  assert((await dock.evaluate(() => window.desktopAPI.getSettings())).quickPanelView === 'grid', '快速面板图标排列没有持久化');
  await dock.screenshot({ path: path.join(artifacts, 'quick-dock-grid.png') });
  await dock.getByTitle('列表排列').click();
  await dock.locator('.dock-list.view-list').waitFor({ state: 'visible' });
  await dock.getByTitle('固定面板').click();
  await dock.getByTitle('取消固定').waitFor({ state: 'visible' });
  const callsBeforePinEnter = await electronApp.evaluate(() => global.__desktopWorkspaceOpenCalls || 0);
  await dock.getByTitle('取消固定').focus();
  await dock.keyboard.press('Enter');
  await dock.getByTitle('固定面板').waitFor({ state: 'visible' });
  assert(await electronApp.evaluate(() => global.__desktopWorkspaceOpenCalls || 0) === callsBeforePinEnter, '快速面板按钮的 Enter 被错误地用于启动项目');
  await dock.locator('.dock-search input').fill('lscsfl');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert(await dock.locator('.dock-scene').count() === 1, '快速面板拼音首字母搜索没有匹配工作场景');
  await dock.locator('.dock-search input').fill('');
  const firstCategory = dock.locator('.dock-categories button').first();
  const categoryLabel = (await firstCategory.textContent())?.trim();
  const categoryId = await firstCategory.getAttribute('data-category-id');
  await firstCategory.click();
  assert(await firstCategory.getAttribute('aria-pressed') === 'true', '快速面板分类没有进入选中状态');
  const expectedCategoryItems = await dock.evaluate(async (selectedCategory) => (await window.desktopAPI.listDesktopItems()).items.filter((item) => !item.hidden && item.exists && item.categoryId === selectedCategory).length, categoryId);
  assert(await dock.locator('[data-dock-item-id]').count() === expectedCategoryItems, '快速面板分类没有显示该分类的全部项目');
  const dockLabels = await dock.locator('[data-dock-item-id] small').allTextContents();
  assert(dockLabels.every((label) => label === categoryLabel), '快速面板分类筛选包含了其他分类');
  await dock.screenshot({ path: path.join(artifacts, 'quick-dock.png') });

  await sidebarNav.getByRole('button', { name: /全部内容/ }).click();
  await main.locator('.item-row').first().waitFor({ state: 'visible' });
  await main.locator('.item-row').first().click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert(await main.locator('.details-pane').count() === 0, '列表行单击不应自动打开详情面板');
  await main.locator('.item-row').first().getByTitle('查看详情').click();
  await main.locator('.details-pane').waitFor({ state: 'visible' });
  await main.locator('.item-row').first().locator('.check-button').click();
  await main.locator('.nav-item').filter({ hasText: '客户项目' }).first().click();
  await main.locator('.selection-bar').waitFor({ state: 'hidden' });
  await sidebarNav.getByRole('button', { name: /全部内容/ }).click();
  await main.locator('.item-row').first().getByTitle('查看详情').click();

  await electronApp.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find((window) => !window.isAlwaysOnTop());
    mainWindow?.setSize(980, 680);
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const bodyWidth = await main.locator('body').evaluate((element) => element.scrollWidth);
  const viewportWidth = await main.locator('body').evaluate((element) => element.clientWidth);
  assert(bodyWidth <= viewportWidth, '最小窗口宽度出现横向溢出');
  assert(await main.locator('.items').evaluate((element) => element.scrollWidth <= element.clientWidth), '窄窗列表和详情面板出现内部横向溢出');
  const compactChecks = main.locator('.item-row .check-button');
  await compactChecks.nth(0).click();
  await compactChecks.nth(1).click();
  const selectionBounds = await main.locator('.selection-bar').boundingBox();
  assert(selectionBounds && selectionBounds.x >= 0 && selectionBounds.x + selectionBounds.width <= viewportWidth, '窄窗批量工具栏超出可视区域');
  await main.keyboard.press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const persistedBounds = await main.evaluate(() => window.desktopAPI.getSettings());
  const savedMainBounds = persistedBounds.mainBounds;
  assert(savedMainBounds && Math.abs(savedMainBounds.width - 980) <= 4 && Math.abs(savedMainBounds.height - 680) <= 4, `主窗口尺寸没有持久化：${JSON.stringify(savedMainBounds)}`);
  await main.screenshot({ path: path.join(artifacts, 'workspace-compact.png') });
  assert(rendererErrors.length === 0, `渲染进程出现未捕获异常：${rendererErrors.join(' | ')}`);

  await main.locator('.window-controls .close-window').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const mainVisibleAfterClose = await electronApp.evaluate(({ BrowserWindow }) => Boolean(BrowserWindow.getAllWindows().find((window) => !window.isAlwaysOnTop())?.isVisible()));
  assert(!mainVisibleAfterClose, '关闭到托盘没有隐藏主窗口');
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.isAlwaysOnTop())?.show());

  await main.getByTitle('设置').click();
  await main.getByRole('checkbox', { name: /关闭到托盘/ }).uncheck();
  await main.getByRole('button', { name: '保存设置' }).click();
  const closingSettings = await main.evaluate(() => window.desktopAPI.getSettings());
  assert(closingSettings.closeToTray === false, '关闭到托盘设置没有保存为关闭');
  const exitPromise = new Promise((resolve) => electronApp.process().once('exit', resolve));
  await main.locator('.window-controls .close-window').click().catch(() => {});
  await Promise.race([
    exitPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('关闭到托盘关闭后，应用没有退出')), 4000)),
  ]);
  appExited = true;
} finally {
  if (!appExited) await electronApp.close();
}

console.log('Electron E2E checks passed.');
