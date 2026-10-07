package com.glide.app.audio

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset

object EmbeddedLyricsReader {

    fun extractLyrics(context: Context, uriString: String?, filePath: String?): String? {
        val uri = when {
            !uriString.isNullOrEmpty() -> Uri.parse(uriString)
            !filePath.isNullOrEmpty() -> Uri.fromFile(File(filePath))
            else -> return null
        }

        return try {
            val lyrics = if (uri.scheme == "content") {
                context.contentResolver.openInputStream(uri)?.use { readFromStream(it) }
            } else {
                File(uri.path ?: return null).inputStream().use { readFromStream(it) }
            }

            if (lyrics != null) {
                return lyrics
            }

            // If not found in start scan, check if it's an MP4 file with metadata at the end
            extractMp4EndLyrics(context, uri)
        } catch (_: Throwable) {
            null
        }
    }

    private fun readFromStream(input: InputStream): String? {
        val header = ByteArray(16)
        val read = input.read(header)
        if (read < 4) return null

        // 1. MP3 / ID3v2 check: starts with "ID3"
        if (header[0] == 'I'.code.toByte() && header[1] == 'D'.code.toByte() && header[2] == '3'.code.toByte()) {
            val version = header[3].toInt() // 3 = v2.3, 4 = v2.4
            val size = ((header[6].toInt() and 0x7F) shl 21) or
                       ((header[7].toInt() and 0x7F) shl 14) or
                       ((header[8].toInt() and 0x7F) shl 7) or
                       (header[9].toInt() and 0x7F)

            if (size <= 0 || size > 16 * 1024 * 1024) return null
            val tagBytes = ByteArray(size)
            var offset = 0
            while (offset < size) {
                val r = input.read(tagBytes, offset, size - offset)
                if (r <= 0) break
                offset += r
            }
            return parseId3v2Lyrics(tagBytes, version)
        }

        // 2. FLAC check: starts with "fLaC"
        if (header[0] == 'f'.code.toByte() && header[1] == 'L'.code.toByte() && header[2] == 'a'.code.toByte() && header[3] == 'C'.code.toByte()) {
            return parseFlacLyrics(input)
        }

        // 3. MP4 / M4A check: must start with ftyp atom (bytes 4..7 == "ftyp")
        if (read >= 8 &&
            header[4] == 'f'.code.toByte() &&
            header[5] == 't'.code.toByte() &&
            header[6] == 'y'.code.toByte() &&
            header[7] == 'p'.code.toByte()
        ) {
            return parseMp4Lyrics(header, read, input)
        }

        return null
    }

    private fun getCharset(encodingByte: Byte): Charset {
        return when (encodingByte.toInt()) {
            1 -> Charsets.UTF_16
            2 -> Charsets.UTF_16BE
            3 -> Charsets.UTF_8
            else -> Charsets.ISO_8859_1
        }
    }

    private fun parseId3v2Lyrics(bytes: ByteArray, version: Int): String? {
        var idx = 0
        while (idx + 10 <= bytes.size) {
            val frameId = String(bytes, idx, 4, Charsets.ISO_8859_1)
            if (frameId.all { it == '\u0000' }) break

            val frameSize = if (version == 4) {
                ((bytes[idx + 4].toInt() and 0x7F) shl 21) or
                ((bytes[idx + 5].toInt() and 0x7F) shl 14) or
                ((bytes[idx + 6].toInt() and 0x7F) shl 7) or
                (bytes[idx + 7].toInt() and 0x7F)
            } else {
                ((bytes[idx + 4].toInt() and 0xFF) shl 24) or
                ((bytes[idx + 5].toInt() and 0xFF) shl 16) or
                ((bytes[idx + 6].toInt() and 0xFF) shl 8) or
                (bytes[idx + 7].toInt() and 0xFF)
            }

            idx += 10
            if (frameSize <= 0 || idx + frameSize > bytes.size) break

            // Keep USLT (unsynced lyrics) only; SYLT is binary with 4-byte timestamps and omitted to avoid binary garbage
            if (frameId == "USLT") {
                val encodingByte = bytes[idx]
                val charset = getCharset(encodingByte)
                var pos = idx + 4 // skip encoding (1) + language (3)

                // Skip descriptor (null terminated)
                if (encodingByte.toInt() == 1 || encodingByte.toInt() == 2) {
                    while (pos + 1 < idx + frameSize) {
                        if (bytes[pos] == 0.toByte() && bytes[pos + 1] == 0.toByte()) {
                            pos += 2
                            break
                        }
                        pos += 2
                    }
                } else {
                    while (pos < idx + frameSize) {
                        if (bytes[pos] == 0.toByte()) {
                            pos += 1
                            break
                        }
                        pos++
                    }
                }

                val lyricsLen = (idx + frameSize) - pos
                if (lyricsLen > 0) {
                    val lyrics = String(bytes, pos, lyricsLen, charset).trim()
                    if (lyrics.isNotEmpty()) return lyrics
                }
            }

            idx += frameSize
        }
        return null
    }

    private fun parseFlacLyrics(input: InputStream): String? {
        var isLast = false
        while (!isLast) {
            val blockHeader = ByteArray(4)
            if (input.read(blockHeader) < 4) break
            val b0 = blockHeader[0].toInt() and 0xFF
            isLast = (b0 and 0x80) != 0
            val blockType = b0 and 0x7F
            val length = ((blockHeader[1].toInt() and 0xFF) shl 16) or
                         ((blockHeader[2].toInt() and 0xFF) shl 8) or
                         (blockHeader[3].toInt() and 0xFF)

            if (blockType == 4) { // VORBIS_COMMENT
                if (length > 4 * 1024 * 1024) return null
                val data = ByteArray(length)
                var read = 0
                while (read < length) {
                    val r = input.read(data, read, length - read)
                    if (r <= 0) break
                    read += r
                }
                return parseVorbisComment(data)
            } else {
                var skipped = 0L
                while (skipped < length) {
                    val s = input.skip(length - skipped)
                    if (s <= 0) break
                    skipped += s
                }
            }
        }
        return null
    }

    private fun parseVorbisComment(data: ByteArray): String? {
        if (data.size < 8) return null
        var pos = 0
        val vendorLen = (data[pos].toInt() and 0xFF) or
                        ((data[pos + 1].toInt() and 0xFF) shl 8) or
                        ((data[pos + 2].toInt() and 0xFF) shl 16) or
                        ((data[pos + 3].toInt() and 0xFF) shl 24)
        pos += 4 + vendorLen
        if (pos + 4 > data.size) return null

        val count = (data[pos].toInt() and 0xFF) or
                    ((data[pos + 1].toInt() and 0xFF) shl 8) or
                    ((data[pos + 2].toInt() and 0xFF) shl 16) or
                    ((data[pos + 3].toInt() and 0xFF) shl 24)
        pos += 4

        for (i in 0 until count) {
            if (pos + 4 > data.size) break
            val commentLen = (data[pos].toInt() and 0xFF) or
                             ((data[pos + 1].toInt() and 0xFF) shl 8) or
                             ((data[pos + 2].toInt() and 0xFF) shl 16) or
                             ((data[pos + 3].toInt() and 0xFF) shl 24)
            pos += 4
            if (pos + commentLen > data.size) break
            val comment = String(data, pos, commentLen, Charsets.UTF_8)
            pos += commentLen
            val upper = comment.uppercase()
            if (upper.startsWith("LYRICS=") || upper.startsWith("UNSYNCEDLYRICS=") || upper.startsWith("SYNCEDLYRICS=")) {
                return comment.substringAfter('=').trim()
            }
        }
        return null
    }

    private fun searchMp4BufferForLyrics(buffer: ByteArray, totalRead: Int): String? {
        val target = byteArrayOf(0xA9.toByte(), 'l'.code.toByte(), 'y'.code.toByte(), 'r'.code.toByte())
        for (i in 0 until totalRead - 16) {
            if (buffer[i] == target[0] && buffer[i + 1] == target[1] && buffer[i + 2] == target[2] && buffer[i + 3] == target[3]) {
                val atomStart = i + 4
                for (j in atomStart until Math.min(atomStart + 24, totalRead - 16)) {
                    if (buffer[j] == 'd'.code.toByte() && buffer[j + 1] == 'a'.code.toByte() && buffer[j + 2] == 't'.code.toByte() && buffer[j + 3] == 'a'.code.toByte()) {
                        val dataAtomSize = ((buffer[j - 4].toInt() and 0xFF) shl 24) or
                                           ((buffer[j - 3].toInt() and 0xFF) shl 16) or
                                           ((buffer[j - 2].toInt() and 0xFF) shl 8) or
                                           (buffer[j - 1].toInt() and 0xFF)
                        val textStart = j + 12
                        val textLen = dataAtomSize - 16
                        if (textStart + textLen <= totalRead && textLen > 0) {
                            val lyrics = String(buffer, textStart, textLen, Charsets.UTF_8).trim()
                            if (lyrics.isNotEmpty()) return lyrics
                        }
                    }
                }
            }
        }
        return null
    }

    private fun parseMp4Lyrics(header: ByteArray, headerLen: Int, input: InputStream): String? {
        val buffer = ByteArray(512 * 1024)
        System.arraycopy(header, 0, buffer, 0, headerLen)
        var totalRead = headerLen
        while (totalRead < buffer.size) {
            val r = input.read(buffer, totalRead, buffer.size - totalRead)
            if (r <= 0) break
            totalRead += r
        }
        return searchMp4BufferForLyrics(buffer, totalRead)
    }

    private fun extractMp4EndLyrics(context: Context, uri: Uri): String? {
        try {
            val pfd = if (uri.scheme == "content") {
                context.contentResolver.openFileDescriptor(uri, "r")
            } else {
                val path = uri.path ?: return null
                val f = File(path)
                if (!f.exists()) return null
                android.os.ParcelFileDescriptor.open(f, android.os.ParcelFileDescriptor.MODE_READ_ONLY)
            } ?: return null

            pfd.use { descriptor ->
                java.io.FileInputStream(descriptor.fileDescriptor).channel.use { channel ->
                    val size = channel.size()
                    if (size <= 512 * 1024) return null

                    // Verify it starts with ftyp
                    val header = ByteBuffer.allocate(16)
                    channel.position(0)
                    channel.read(header)
                    val hb = header.array()
                    val isFtyp = hb[4] == 'f'.code.toByte() &&
                                 hb[5] == 't'.code.toByte() &&
                                 hb[6] == 'y'.code.toByte() &&
                                 hb[7] == 'p'.code.toByte()
                    if (!isFtyp) return null

                    // Read last 512 KB where trailing moov atom resides
                    val readSize = (512 * 1024).coerceAtMost(size.toInt())
                    val endBuffer = ByteBuffer.allocate(readSize)
                    channel.position(size - readSize)
                    val bytesRead = channel.read(endBuffer)
                    if (bytesRead > 0) {
                        return searchMp4BufferForLyrics(endBuffer.array(), bytesRead)
                    }
                }
            }
        } catch (_: Throwable) {}
        return null
    }
}
