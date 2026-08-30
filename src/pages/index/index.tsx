import { useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'
import kitchenHero from '@/assets/recipes/kitchen-hero.jpg'
import HeartMealIcon from '@/components/Icon'
import PersistedImage from '@/components/PersistedImage'
import { CartItem, Category, Recipe } from '@/types'
import { addRecipeToCart, calcTotalCount, getCart, updateCartItemQuantity } from '@/utils/cart'
import { getCategories } from '@/utils/categories'
import { getRecipes } from '@/utils/recipes'
import './index.scss'

export default function KitchenPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const refresh = () => {
    setCategories(getCategories().filter((item) => item.enabled))
    setRecipes(getRecipes())
    setCart(getCart())
  }
  useDidShow(refresh)

  const visibleRecipes = useMemo(() => {
    const query = keyword.trim()
    return recipes.filter((recipe) => recipe.enabled)
      .filter((recipe) => activeCategory === 'all' || recipe.categoryId === activeCategory)
      .filter((recipe) => !query || recipe.name.includes(query))
  }, [recipes, activeCategory, keyword])

  const totalCount = calcTotalCount(cart)
  const quantityOf = (recipeId: string) => cart.find((item) => item.recipeId === recipeId)?.quantity || 0
  const syncCart = (next: CartItem[]) => setCart(next)

  return (
    <View className='pk-page kitchen-page'>
      <View className='kitchen-hero'>
        <Image className='kitchen-hero-image' src={kitchenHero} mode='aspectFill' />
      </View>

      <View className='kitchen-shell'>
        <View className='kitchen-brand'>
          <View className='kitchen-brand-mark'><HeartMealIcon name='dish' size='lg' /></View>
          <View className='kitchen-brand-copy'>
            <View className='kitchen-brand-title'>私人厨房</View>
            <View className='kitchen-brand-subtitle'>认真吃饭，也认真记录每一道菜</View>
          </View>
        </View>

        <View className='kitchen-toolbar'>
          <View className='kitchen-toolbar-title'>我的菜谱</View>
          <View className='kitchen-toolbar-actions'>
            <Button className='manage-entry' hoverClass='button-hover' onClick={() => Taro.navigateTo({ url: '/pages/recipe-manage/index' })}>管理</Button>
            <Button className='add-entry' hoverClass='button-hover' onClick={() => Taro.navigateTo({ url: '/pages/recipe-manage/index?add=1' })}><HeartMealIcon name='plus' size='md' />添加菜谱</Button>
            <Button className={`search-entry ${searchOpen ? 'is-active' : ''}`} hoverClass='button-hover' onClick={() => setSearchOpen(!searchOpen)}><HeartMealIcon name='search' size='md' /></Button>
          </View>
        </View>

        {searchOpen && <View className='kitchen-search-wrap'><HeartMealIcon name='search' size='sm' /><Input className='kitchen-search' value={keyword} focus placeholder='搜索菜谱名称' onInput={(event) => setKeyword(event.detail.value)} /></View>}

        <View className='kitchen-body'>
          <ScrollView className='category-side' scrollY>
            <View className={`category-item ${activeCategory === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCategory('all')}>
              <Text>全部</Text><Text>{recipes.filter((item) => item.enabled).length}</Text>
            </View>
            {categories.map((category) => (
              <View key={category.id} className={`category-item ${activeCategory === category.id ? 'is-active' : ''}`} onClick={() => setActiveCategory(category.id)}>
                <Text>{category.name}</Text>
                <Text>{recipes.filter((item) => item.enabled && item.categoryId === category.id).length}</Text>
              </View>
            ))}
            <View className='category-manage-link' onClick={() => Taro.navigateTo({ url: '/pages/category-manage/index' })}><HeartMealIcon name='setting' size='sm' /><Text>分类管理</Text></View>
          </ScrollView>

          <ScrollView className='recipe-pane' scrollY>
            {!visibleRecipes.length ? (
              <View className='pk-empty kitchen-empty'><View className='pk-empty-title'>没有找到菜谱</View><View className='pk-empty-desc'>可以去管理页新建或上架菜谱</View></View>
            ) : visibleRecipes.map((recipe) => {
              const quantity = quantityOf(recipe.id)
              return (
                <View key={recipe.id} className='kitchen-recipe'>
                  <View className='recipe-tap' onClick={() => Taro.navigateTo({ url: `/pages/recipe-detail/index?id=${recipe.id}` })}>
                    {recipe.coverImage
                      ? <PersistedImage className='kitchen-cover' src={recipe.coverImage} mode='aspectFill' />
                      : <View className='kitchen-cover pk-cover-fallback'>{recipe.name.slice(0, 1)}</View>}
                    <View className='kitchen-copy'>
                      <View className='kitchen-name'>{recipe.name}</View>
                      <View className='kitchen-desc'>{recipe.description || '点击查看用料和做法'}</View>
                    </View>
                  </View>
                  <View className='kitchen-stepper'>
                    {quantity > 0 && <Button className='round-button' hoverClass='button-hover' onClick={() => syncCart(updateCartItemQuantity(recipe.id, -1, cart))}><HeartMealIcon name='minus' size='sm' /></Button>}
                    {quantity > 0 && <Text className='quantity'>{quantity}</Text>}
                    <Button className='round-button is-plus' hoverClass='button-hover' onClick={() => syncCart(addRecipeToCart(recipe, cart))}><HeartMealIcon name='plus' size='md' /></Button>
                  </View>
                </View>
              )
            })}
          </ScrollView>
        </View>
      </View>

      <View className={`kitchen-cart-bar ${totalCount ? 'is-ready' : ''}`}>
        <View className='cart-summary' onClick={() => Taro.navigateTo({ url: '/pages/cart/index' })}>
          <View className='cart-badge'><HeartMealIcon name='cart' size='lg' />{totalCount > 0 && <Text>{totalCount}</Text>}</View>
          <View><View className='cart-title'>{totalCount ? `已选 ${totalCount} 件` : '本次菜单'}</View><View className='cart-desc'>{totalCount ? '点击查看和调整' : '先选一道想吃的菜'}</View></View>
        </View>
        <Button className='cart-order-button' disabled={!totalCount} hoverClass='button-hover' onClick={() => Taro.navigateTo({ url: '/pages/cart/index' })}>下单</Button>
      </View>
    </View>
  )
}
