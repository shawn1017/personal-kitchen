import { useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Image, Input, Text, View } from '@tarojs/components'
import { HeartMealIconName } from '@/assets/icons'
import HeartMealIcon from '@/components/Icon'
import { Category, Recipe } from '@/types'
import { getCategories } from '@/utils/categories'
import { removeCartItem } from '@/utils/cart'
import { deleteRecipe, getRecipes, moveRecipe, setAllRecipesEnabled, updateRecipe } from '@/utils/recipes'
import './index.scss'

export default function RecipeManagePage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [addSheetOpen, setAddSheetOpen] = useState(router.params.add === '1')
  const refresh = () => { setCategories(getCategories()); setRecipes(getRecipes()) }
  useDidShow(refresh)

  const filtered = useMemo(() => recipes
    .filter((item) => activeCategory === 'all' || item.categoryId === activeCategory)
    .filter((item) => !keyword.trim() || item.name.includes(keyword.trim())), [recipes, activeCategory, keyword])

  const addOptions: Array<{ title: string; description: string; tag?: string; icon: HeartMealIconName; tone: string; action: () => void }> = [
    { title: '寻味偷菜', description: '浏览现成灵感，快速加入厨房', tag: '即将开放', icon: 'search', tone: 'green', action: () => Taro.showToast({ title: '现成菜谱库正在准备中', icon: 'none' }) },
    { title: '快速添加', description: '只填菜名、分类和封面', tag: '最快', icon: 'plus', tone: 'blue', action: () => Taro.navigateTo({ url: '/pages/recipe-edit/index?mode=quick' }) },
    { title: '链接导入', description: '支持小红书、下厨房公开链接', tag: '推荐', icon: 'reorder', tone: 'red', action: () => Taro.navigateTo({ url: '/pages/recipe-import/index' }) },
    { title: '详细录入', description: '完整记录用料、步骤和经验', icon: 'note', tone: 'purple', action: () => Taro.navigateTo({ url: '/pages/recipe-edit/index' }) }
  ]

  const chooseAddOption = (action: () => void) => {
    setAddSheetOpen(false)
    setTimeout(action, 120)
  }

  const confirmDelete = (recipe: Recipe) => {
    Taro.showModal({ title: '删除菜谱', content: `确定删除「${recipe.name}」吗？历史订单中的快照不会受影响。`, confirmText: '删除', confirmColor: '#c14e48' }).then((result) => {
      if (!result.confirm) return
      try {
        const nextRecipes = deleteRecipe(recipe.id)
        removeCartItem(recipe.id)
        setRecipes(nextRecipes)
      } catch {
        Taro.showToast({ title: '删除失败，请检查存储空间', icon: 'none' })
      }
    })
  }

  return (
    <View className='pk-page manage-page'>
      <View className='manage-head'><View><View className='pk-title'>菜谱管理</View><View className='pk-subtitle'>维护我的私人菜谱库</View></View><Button className='add-recipe' onClick={() => setAddSheetOpen(true)}><HeartMealIcon name='plus' size='md' />添加菜谱</Button></View>
      <View className='manage-search'><HeartMealIcon name='search' size='md' /><Input value={keyword} placeholder='搜索菜谱名称' onInput={(event) => setKeyword(event.detail.value)} /></View>
      <View className='manage-tools'>
        <Button onClick={() => Taro.navigateTo({ url: '/pages/category-manage/index' })}><HeartMealIcon name='setting' size='sm' />分类管理</Button>
        <Button onClick={() => setRecipes(setAllRecipesEnabled(true))}>全部上架</Button>
        <Button onClick={() => setRecipes(setAllRecipesEnabled(false))}>全部下架</Button>
      </View>
      <View className='manage-body'>
        <View className='manage-category-side'>
          <View className={activeCategory === 'all' ? 'is-active' : ''} onClick={() => setActiveCategory('all')}><Text>全部</Text><Text>{recipes.length}</Text></View>
          {categories.map((category) => <View key={category.id} className={activeCategory === category.id ? 'is-active' : ''} onClick={() => setActiveCategory(category.id)}><Text>{category.name}</Text><Text>{recipes.filter((item) => item.categoryId === category.id).length}</Text></View>)}
        </View>
        <View className='manage-list-pane'>
          {!filtered.length ? <View className='pk-empty manage-empty'><View className='pk-empty-title'>还没有菜谱</View><View className='pk-empty-desc'>点击“添加菜谱”开始建立你的厨房</View></View> : (
            <View className='manage-list'>{filtered.map((recipe, index) => (
              <View key={recipe.id} className='manage-card'>
                {recipe.coverImage ? <Image className='manage-cover' src={recipe.coverImage} mode='aspectFill' /> : <View className='manage-cover pk-cover-fallback'>{recipe.name.slice(0, 1)}</View>}
                <View className='manage-main'>
                  <View className='manage-name'>{recipe.name}</View>
                  <View className={`manage-status ${recipe.enabled ? 'enabled' : ''}`}>{recipe.enabled ? '上架中' : '已下架'}</View>
                  <View className='manage-actions'>
                    <Button onClick={() => { updateRecipe(recipe.id, { enabled: !recipe.enabled }); refresh() }}>{recipe.enabled ? '下架' : '上架'}</Button>
                    <Button onClick={() => Taro.navigateTo({ url: `/pages/recipe-edit/index?id=${recipe.id}` })}>编辑</Button>
                    <Button className='danger' onClick={() => confirmDelete(recipe)}>删除</Button>
                  </View>
                  <View className='sort-actions'>
                    <Text>排序</Text><Button disabled={index === 0} onClick={() => setRecipes(moveRecipe(recipe.id, -1))}>上移</Button><Button disabled={index === filtered.length - 1} onClick={() => setRecipes(moveRecipe(recipe.id, 1))}>下移</Button>
                  </View>
                </View>
              </View>
            ))}</View>
          )}
        </View>
      </View>

      {addSheetOpen && <View className='add-sheet-mask' onClick={() => setAddSheetOpen(false)}>
        <View className='add-sheet' onClick={(event) => event.stopPropagation()}>
          <View className='sheet-handle' />
          <View className='sheet-title'>添加方式</View>
          <View className='sheet-subtitle'>按需选择最适合的方式</View>
          <View className='sheet-options'>{addOptions.map((option) => <View key={option.title} className='sheet-option' onClick={() => chooseAddOption(option.action)}>
            <View className={`sheet-option-icon ${option.tone}`}><HeartMealIcon name={option.icon} size='lg' /></View>
            <View className='sheet-option-copy'><View className='sheet-option-title'>{option.title}{option.tag && <Text>{option.tag}</Text>}</View><View className='sheet-option-desc'>{option.description}</View></View>
          </View>)}</View>
          <Button className='sheet-cancel' onClick={() => setAddSheetOpen(false)}>取消</Button>
        </View>
      </View>}
    </View>
  )
}
