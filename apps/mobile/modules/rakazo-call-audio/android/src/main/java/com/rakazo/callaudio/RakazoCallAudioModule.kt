package com.rakazo.callaudio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Puts the device in communication mode for a hands-free call, like a phone or VoIP app.
 * The microphone then records through the voice-communication path, where the platform's
 * acoustic echo canceller removes the bot's voice playing from the speaker, so it is not
 * transcribed as the caller while the caller can still talk over it. Audio stays on the
 * loudspeaker unless a headset is connected.
 */
class RakazoCallAudioModule : Module() {
  private var active = false
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeakerphone = false
  private var modeListener: Any? = null

  private fun audioManager(): AudioManager? =
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("RakazoCallAudio")

    Function("enter") {
      val manager = audioManager() ?: return@Function false
      if (!active) {
        previousMode = manager.mode
        @Suppress("DEPRECATION")
        previousSpeakerphone = manager.isSpeakerphoneOn
        active = true
        watchMode(manager)
      }
      apply(manager)
      true
    }

    // Other audio code (a player setting its audio mode) can drop the mode; put it back.
    Function("reassert") {
      val manager = audioManager() ?: return@Function false
      if (active) apply(manager)
      active
    }

    Function("leave") {
      val manager = audioManager() ?: return@Function false
      if (!active) return@Function true
      active = false
      unwatchMode(manager)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        manager.clearCommunicationDevice()
      }
      @Suppress("DEPRECATION")
      manager.isSpeakerphoneOn = previousSpeakerphone
      manager.mode =
        if (previousMode == AudioManager.MODE_IN_COMMUNICATION) AudioManager.MODE_NORMAL else previousMode
      true
    }

    Function("isEchoCancellerAvailable") {
      android.media.audiofx.AcousticEchoCanceler.isAvailable()
    }

    OnDestroy {
      audioManager()?.let { manager ->
        if (active) {
          active = false
          unwatchMode(manager)
          manager.mode = AudioManager.MODE_NORMAL
        }
      }
    }
  }

  private fun apply(manager: AudioManager) {
    if (manager.mode != AudioManager.MODE_IN_COMMUNICATION) {
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = manager.availableCommunicationDevices
      val headset = devices.firstOrNull { it.type in HEADSET_TYPES }
      val target = headset ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      if (target != null && manager.communicationDevice?.id != target.id) {
        manager.setCommunicationDevice(target)
      }
    } else {
      @Suppress("DEPRECATION")
      val headset = manager.isWiredHeadsetOn || manager.isBluetoothScoOn
      @Suppress("DEPRECATION")
      manager.isSpeakerphoneOn = !headset
    }
  }

  private fun watchMode(manager: AudioManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || modeListener != null) return
    val listener =
      AudioManager.OnModeChangedListener { mode ->
        if (active && mode != AudioManager.MODE_IN_COMMUNICATION) {
          Handler(Looper.getMainLooper()).post { if (active) apply(manager) }
        }
      }
    manager.addOnModeChangedListener(appContext.reactContext!!.mainExecutor, listener)
    modeListener = listener
  }

  private fun unwatchMode(manager: AudioManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    (modeListener as? AudioManager.OnModeChangedListener)?.let {
      manager.removeOnModeChangedListener(it)
    }
    modeListener = null
  }

  companion object {
    private val HEADSET_TYPES =
      setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        26, // TYPE_BLE_HEADSET (API 31)
      )
  }
}
