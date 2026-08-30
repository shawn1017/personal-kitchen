import { useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'
import PersistedImage from '@/components/PersistedImage'
import { Recipe } from '@/types'
import { addRecipeToCart } from '@/utils/cart'
import { getRecipe } from '@/utils/recipes'
import './index.scss'

const platformLabels = { xiaohongshu: '小红书', xiachufang: '下厨房', manual: '手工录入' }

export default function RecipeDetailPage() {
  const router = useRouter()
  const [recipe, setRecipe] = useState<Recipe>()
  useDidShow(() => setRecipe(getRecipe(String(router.params.id || ''))))
  if (!recipe) return <View className='pk-page'><View className='pk-empty pk-card'><View className='pk-empty-title'>菜谱不存在</View><View className='pk-empty-desc'>它可能已经被删除</View></View></View>

  return (
    <View className='pk-page detail-page'>
      {recipe.coverImage ? <PersistedImage className='detail-cover' src={recipe.coverImage} mode='aspectFill' /> : <View className='detail-cover pk-cover-fallback'>{recipe.name.slice(0, 1)}</View>}
      <View className='detail-title'>{recipe.name}</View>
      {recipe.description && <View className='detail-description'>{recipe.description}</View>}
      <View className='detail-section pk-card'><View className='detail-section-title'>用料</View>{recipe.ingredients.length ? recipe.ingredients.map((item) => <View key={item.id} className='ingredient-row'><Text>{item.name}</Text><Text>{[item.amount, item.unit, item.remark].filter(Boolean).join(' ') || '适量'}</Text></View>) : <View className='section-empty'>暂未填写用料</View>}</View>
      <View className='detail-section pk-card'><View className='detail-section-title'>做法步骤</View>{recipe.steps.length ? recipe.steps.map((step, index) => <View key={step.id} className='detail-step'><View className='step-number'>{index + 1}</View><View className='step-content'>{step.image && <PersistedImage className='step-image' src={step.image} mode='aspectFill' />}<View>{step.text || '待补充说明'}</View>{step.timerSeconds && <View className='step-timer'>计时 {Math.round(step.timerSeconds / 60)} 分钟</View>}</View></View>) : <View className='section-empty'>暂未填写步骤</View>}</View>
      {recipe.tips && <View className='detail-section tips-card'><View className='detail-section-title'>烹饪经验</View><View className='tips-content'>{recipe.tips}</View></View>}
      {recipe.source && <View className='detail-section source-card'><View className='detail-section-title'>来源信息</View><View>来源：{platformLabels[recipe.source.platform]}</View>{recipe.source.authorName && <View>作者：{recipe.source.authorName}</View>}{recipe.source.sourceUrl && <View className='source-url'>原始链接：{recipe.source.sourceUrl}</View>}</View>}
      <View className='detail-actions'><Button className='pk-secondary' onClick={() => Taro.navigateTo({ url: `/pages/recipe-edit/index?id=${recipe.id}` })}>编辑菜谱</Button><Button className='pk-primary' disabled={!recipe.enabled} onClick={() => { addRecipeToCart(recipe); Taro.showToast({ title: '已加入本次菜单', icon: 'success' }) }}>+ 加入菜单</Button></View>
    </View>
  )
}
