import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const InterviewGenieApp());
}

class InterviewGenieApp extends StatelessWidget {
  const InterviewGenieApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Interview Genie',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo, brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _apiUrlController = TextEditingController(text: 'ws://10.0.2.2:8000/ws/audio');
  final _record = AudioRecorder();
  bool _isRecording = false;
  String _status = '';
  Map<String, String>? _star;
  String? _error;

  Future<bool> _requestMic() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> _startRecording() async {
    setState(() {
      _error = null;
      _star = null;
      _status = 'Requesting microphone…';
    });
    final ok = await _requestMic();
    if (!ok) {
      setState(() {
        _error = 'Microphone permission denied';
        _status = '';
      });
      return;
    }
    final dir = await getTemporaryDirectory();
    final recordingPath = '${dir.path}/interview_genie_${DateTime.now().millisecondsSinceEpoch}.wav';
    await _record.start(const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 16000), path: recordingPath);
    if (!await _record.isRecording()) {
      setState(() {
        _error = 'Failed to start recorder';
        _status = '';
      });
      return;
    }
    setState(() {
      _isRecording = true;
      _status = 'Recording… Speak your question, then tap Stop.';
    });
  }

  Future<void> _stopAndSend() async {
    final path = await _record.stop();
    if (path == null || !mounted) return;
    setState(() {
      _isRecording = false;
      _status = 'Sending and processing…';
    });

    final file = File(path);
    if (!await file.exists()) {
      setState(() => _status = '');
      return;
    }
    final bytes = await file.readAsBytes();

    final uri = Uri.parse(_apiUrlController.text.trim());
    final channel = WebSocketChannel.connect(uri);

    channel.sink.add(bytes);
    channel.sink.add(utf8.encode('{"done":true}'));

    await for (final message in channel.stream) {
      if (!mounted) break;
      if (message is String) {
        try {
          final data = _parseJson(message);
          if (data == null) continue;
          if (data['error'] != null) {
            setState(() {
              _error = data['error'] as String;
              _status = '';
            });
            break;
          }
          if (data['status'] == 'processing') {
            setState(() => _status = 'Generating STAR answer…');
            continue;
          }
          if (data['situation'] != null) {
            setState(() {
              _star = {
                'situation': data['situation']?.toString() ?? '—',
                'task': data['task']?.toString() ?? '—',
                'action': data['action']?.toString() ?? '—',
                'result': data['result']?.toString() ?? '—',
              };
              _status = 'Done.';
            });
            break;
          }
        } catch (_) {}
      }
    }
    channel.sink.close();
  }

  Map<String, dynamic>? _parseJson(String s) {
    try {
      final decoded = jsonDecode(s);
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded as Map);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Interview Genie'),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _apiUrlController,
                decoration: const InputDecoration(
                  labelText: 'API URL',
                  hintText: 'ws://localhost:8000/ws/audio',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: _isRecording ? null : _startRecording,
                      child: const Text('Start recording'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton.tonal(
                      onPressed: _isRecording ? _stopAndSend : null,
                      child: const Text('Stop & get answer'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(_status, style: Theme.of(context).textTheme.bodySmall),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Card(
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(_error!),
                  ),
                ),
              ],
              if (_star != null) ...[
                const SizedBox(height: 20),
                Text('STAR answer', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                _StarCard(title: 'Situation', text: _star!['situation']!),
                _StarCard(title: 'Task', text: _star!['task']!),
                _StarCard(title: 'Action', text: _star!['action']!),
                _StarCard(title: 'Result', text: _star!['result']!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _StarCard extends StatelessWidget {
  final String title;
  final String text;

  const _StarCard({required this.title, required this.text});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
            ),
            const SizedBox(height: 4),
            Text(text),
          ],
        ),
      ),
    );
  }
}

