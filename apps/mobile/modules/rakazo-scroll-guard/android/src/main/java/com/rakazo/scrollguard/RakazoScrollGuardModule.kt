package com.rakazo.scrollguard

import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

class RakazoScrollGuardModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RakazoScrollGuard")

    View(RakazoScrollGuardView::class) {
      Prop("enabled") { view: RakazoScrollGuardView, enabled: Boolean ->
        view.guarding = enabled
      }
    }
  }
}

/**
 * Wraps a horizontal scroller that sits inside a vertical one (a wide table in the chat list).
 *
 * Android's vertical ScrollView takes a touch as soon as it has moved a few pixels up or down,
 * and it is asked before the table is. A quick sideways swipe always drifts a little, and with
 * coarse touch samples both thresholds are crossed on the same move, so the chat list won and the
 * table never scrolled. While a touch starts here, the ancestors are told to keep out; once the
 * gesture has a direction, a vertical one is handed back to the list and a horizontal one stays
 * with the table. A touch that does not move (a long-press) is left alone.
 */
class RakazoScrollGuardView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  var guarding = false
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var startX = 0f
  private var startY = 0f
  private var decided = false
  private var vertical = false

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (guarding) {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startX = event.x
          startY = event.y
          decided = false
          vertical = false
          parent?.requestDisallowInterceptTouchEvent(true)
        }
        MotionEvent.ACTION_MOVE -> {
          if (!decided) {
            val dx = abs(event.x - startX)
            val dy = abs(event.y - startY)
            if (dx > touchSlop || dy > touchSlop) {
              decided = true
              vertical = dy > dx
              if (vertical) parent?.requestDisallowInterceptTouchEvent(false)
            }
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          decided = false
          vertical = false
        }
      }
    }
    return super.dispatchTouchEvent(event)
  }

  // A vertical swipe must not start the table scrolling on its way to the list.
  override fun onInterceptTouchEvent(event: MotionEvent): Boolean =
    if (guarding && decided && vertical) true else super.onInterceptTouchEvent(event)

  override fun onTouchEvent(event: MotionEvent): Boolean =
    if (guarding && decided && vertical) true else super.onTouchEvent(event)
}
