package com.getcapacitor.annotation

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class CapacitorPlugin(val name: String = "")
