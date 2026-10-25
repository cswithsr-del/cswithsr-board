// Cambridge Computer Science chapters and topics. Edit freely: topics you add in the app are stored separately.
export const LEVELS = [
  { id: 'ol', name: 'O Level / IGCSE', code: '2210 · 0478', chips: ['O LEVEL 2210', 'IGCSE 0478'], papers: [
    { id: 'p1', name: 'Paper 1 · Computer Systems', chapters: [
      { n: 1, name: 'Data Representation', topics: ['1.1 Number Systems', '1.2 Text, Sound and Images', '1.3 Data Storage and Compression'] },
      { n: 2, name: 'Data Transmission', topics: ['2.1 Types and Methods of Data Transmission', '2.2 Methods of Error Detection', '2.3 Encryption'] },
      { n: 3, name: 'Hardware', topics: ['3.1 Computer Architecture', '3.2 Input and Output Devices', '3.3 Data Storage', '3.4 Network Hardware'] },
      { n: 4, name: 'Software', topics: ['4.1 Types of Software and Interrupts', '4.2 Programming Languages, Translators and IDEs'] },
      { n: 5, name: 'The Internet and its Uses', topics: ['5.1 The Internet and the World Wide Web', '5.2 Digital Currency', '5.3 Cyber Security'] },
      { n: 6, name: 'Automated and Emerging Technologies', topics: ['6.1 Automated Systems', '6.2 Robotics', '6.3 Artificial Intelligence'] },
    ]},
    { id: 'p2', name: 'Paper 2 · Algorithms, Programming and Logic', chapters: [
      // chapters 7 and 8 are taught together; add your own subtopics in the app
      { n: 7, label: '07–08', name: 'Algorithms, Problem-solving and Programming', topics: [], merged: [7, 8],
        legacy: ['7.1 Program Development Life Cycle', '7.2 Decomposition and Structure Diagrams', '7.3 Flowcharts and Pseudocode', '7.4 Standard Methods', '7.5 Validation and Verification', '7.6 Test Data and Trace Tables', '8.1 Programming Concepts', '8.2 Arrays', '8.3 File Handling'] },
      { n: 9, name: 'Databases', topics: ['9.1 Database Structure', '9.2 SQL'] },
      { n: 10, name: 'Boolean Logic', topics: ['10.1 Logic Gates', '10.2 Logic Circuits and Truth Tables'] },
    ]},
  ]},
  { id: 'as', name: 'AS Level', code: '9618', chips: ['AS LEVEL 9618'], papers: [
    { id: 'p1', name: 'Paper 1 · Theory Fundamentals', chapters: [
      { n: 1, name: 'Information Representation', topics: ['1.1 Data Representation', '1.2 Multimedia', '1.3 Compression'] },
      { n: 2, name: 'Communication', topics: ['2.1 Networks including the Internet'] },
      { n: 3, name: 'Hardware', topics: ['3.1 Computers and their Components', '3.2 Logic Gates and Logic Circuits'] },
      { n: 4, name: 'Processor Fundamentals', topics: ['4.1 Central Processing Unit Architecture', '4.2 Assembly Language', '4.3 Bit Manipulation'] },
      { n: 5, name: 'System Software', topics: ['5.1 Operating Systems', '5.2 Language Translators'] },
      { n: 6, name: 'Security, Privacy and Data Integrity', topics: ['6.1 Data Security', '6.2 Data Integrity'] },
      { n: 7, name: 'Ethics and Ownership', topics: ['7.1 Ethics and Ownership'] },
      { n: 8, name: 'Databases', topics: ['8.1 Database Concepts', '8.2 Database Management Systems', '8.3 Data Definition and Manipulation Language'] },
    ]},
    { id: 'p2', name: 'Paper 2 · Fundamental Problem-solving and Programming', chapters: [
      // chapters 9, 10 and 11 are taught together; add your own subtopics in the app
      { n: 9, label: '09–11', name: 'Algorithms, Data Structures and Programming', topics: [], merged: [9, 10, 11],
        legacy: ['9.1 Computational Thinking Skills', '9.2 Algorithms', '10.1 Data Types and Records', '10.2 Arrays', '10.3 Files', '10.4 Introduction to Abstract Data Types', '11.1 Programming Basics', '11.2 Constructs', '11.3 Structured Programming'] },
      { n: 12, name: 'Software Development', topics: ['12.1 Program Development Life Cycle', '12.2 Program Design', '12.3 Program Testing and Maintenance'] },
    ]},
  ]},
  { id: 'a2', name: 'A2 Level', code: '9618', chips: ['A2 LEVEL 9618'], papers: [
    { id: 'p3', name: 'Paper 3 · Advanced Theory', chapters: [
      { n: 13, name: 'Data Representation', topics: ['13.1 User-defined Data Types', '13.2 File Organisation and Access', '13.3 Floating-point Numbers'] },
      { n: 14, name: 'Communication and Internet Technologies', topics: ['14.1 Protocols', '14.2 Circuit Switching and Packet Switching'] },
      { n: 15, name: 'Hardware and Virtual Machines', topics: ['15.1 Processors, Parallel Processing and Virtual Machines', '15.2 Boolean Algebra and Logic Circuits'] },
      { n: 16, name: 'System Software', topics: ['16.1 Purposes of an Operating System', '16.2 Translation Software'] },
      { n: 17, name: 'Security', topics: ['17.1 Encryption, Protocols and Digital Certificates'] },
      { n: 18, name: 'Artificial Intelligence', topics: ['18.1 Artificial Intelligence'] },
    ]},
    { id: 'p4', name: 'Paper 4 · Practical', chapters: [
      { n: 19, name: 'Computational Thinking and Problem-solving', topics: ['19.1 Algorithms', '19.2 Recursion'] },
      { n: 20, name: 'Further Programming', topics: ['20.1 Programming Paradigms', '20.2 File Processing and Exception Handling'] },
    ]},
  ]},
];
export const topicId = (lv, name) => lv + ':' + name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
export const chLabel = ch => ch.label || String(ch.n).padStart(2, '0');
// custom topics belong to a chapter number; merged chapters collect all of their old numbers
export const inChapter = (ch, n) => n === ch.n || (ch.merged || []).includes(n);
